"""Neural next-symbol predictors: GRU and a fine-tuned transformer encoder (proposal 3.3.4).

Both share the Predictor interface, so evaluation, masking and the personal re-ranker are
identical across families. Training details that the proposal fixes:
  * fitting on train only; validation used for early stopping and hyper-parameters;
  * three seeds reported for every neural model;
  * the next symbol is the target and never appears in the input; later symbols are never given.

Transformer input: the documented Kinyarwanda lexical form of each preceding symbol, in order,
followed by the tokenizer's mask token as the terminal prediction position. The hidden state at
that position feeds a linear head over symbol ids (incl. EOS).
"""
from __future__ import annotations

import json
import math
import os
import random
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import numpy as np
import torch
import torch.nn as nn

from .. import BOS, EOS
from .base import Predictor

PAD = "<pad>"


class SymbolVocab:
    def __init__(self, symbols: list[str]):
        self.itos = [PAD, BOS, EOS] + sorted(s for s in set(symbols) if s not in (PAD, BOS, EOS))
        self.stoi = {s: i for i, s in enumerate(self.itos)}

    def __len__(self) -> int:
        return len(self.itos)

    def encode(self, seq: tuple[str, ...]) -> list[int]:
        return [self.stoi.get(s, self.stoi[PAD]) for s in seq]


def _seed(seed: int) -> None:
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ---- GRU --------------------------------------------------------------------------------------
class _GRUNet(nn.Module):
    def __init__(self, n_symbols: int, emb: int, hidden: int, layers: int, dropout: float):
        super().__init__()
        self.emb = nn.Embedding(n_symbols, emb, padding_idx=0)
        self.gru = nn.GRU(emb, hidden, num_layers=layers, batch_first=True,
                          dropout=dropout if layers > 1 else 0.0)
        self.drop = nn.Dropout(dropout)
        self.out = nn.Linear(hidden, n_symbols)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # (B, T) -> (B, T, V)
        h, _ = self.gru(self.emb(x))
        return self.out(self.drop(h))


class GRUPredictor(Predictor):
    name = "gru"

    def __init__(self, emb: int = 64, hidden: int = 128, layers: int = 1, dropout: float = 0.2,
                 lr: float = 2e-3, batch_size: int = 128, epochs: int = 20, patience: int = 3,
                 seed: int = 0):
        self.cfg = dict(emb=emb, hidden=hidden, layers=layers, dropout=dropout, lr=lr,
                        batch_size=batch_size, epochs=epochs, patience=patience, seed=seed)
        self.vocab: SymbolVocab | None = None
        self.net: _GRUNet | None = None
        self.history: list[dict] = []

    # -- data
    def _batches(self, seqs: list[tuple[str, ...]], shuffle: bool):
        idx = list(range(len(seqs)))
        if shuffle:
            random.shuffle(idx)
        bs = self.cfg["batch_size"]
        for i in range(0, len(idx), bs):
            chunk = [seqs[j] for j in idx[i:i + bs]]
            T = max(len(s) for s in chunk) + 1
            x = torch.zeros(len(chunk), T, dtype=torch.long)
            y = torch.zeros(len(chunk), T, dtype=torch.long)
            for r, s in enumerate(chunk):
                ids = [self.vocab.stoi[BOS]] + self.vocab.encode(s)
                tgt = self.vocab.encode(s) + [self.vocab.stoi[EOS]]
                x[r, :len(ids)] = torch.tensor(ids)
                y[r, :len(tgt)] = torch.tensor(tgt)
            yield x, y

    def _loss(self, seqs, dev) -> float:
        self.net.eval(); tot = 0.0; n = 0
        crit = nn.CrossEntropyLoss(ignore_index=0, reduction="sum")
        with torch.no_grad():
            for x, y in self._batches(seqs, False):
                x, y = x.to(dev), y.to(dev)
                logits = self.net(x)
                tot += crit(logits.reshape(-1, logits.size(-1)), y.reshape(-1)).item()
                n += (y != 0).sum().item()
        return tot / max(n, 1)

    def fit(self, sequences: list[tuple[str, ...]], val_sequences: list[tuple[str, ...]] | None = None,
            symbols: list[str] | None = None) -> None:
        """`symbols`: the full board vocabulary; every symbol gets an output slot even if it never
        occurs in training, so evaluation targets are never silently dropped."""
        _seed(self.cfg["seed"])
        self.vocab = SymbolVocab([s for seq in sequences for s in seq] + list(symbols or []))
        dev = _device()
        self.net = _GRUNet(len(self.vocab), self.cfg["emb"], self.cfg["hidden"], self.cfg["layers"],
                           self.cfg["dropout"]).to(dev)
        opt = torch.optim.Adam(self.net.parameters(), lr=self.cfg["lr"])
        crit = nn.CrossEntropyLoss(ignore_index=0)
        best, best_state, bad = math.inf, None, 0
        for epoch in range(self.cfg["epochs"]):
            self.net.train(); tl = 0.0; nb = 0
            for x, y in self._batches(sequences, True):
                x, y = x.to(dev), y.to(dev)
                opt.zero_grad()
                logits = self.net(x)
                loss = crit(logits.reshape(-1, logits.size(-1)), y.reshape(-1))
                loss.backward(); nn.utils.clip_grad_norm_(self.net.parameters(), 1.0); opt.step()
                tl += loss.item(); nb += 1
            vl = self._loss(val_sequences, dev) if val_sequences else tl / max(nb, 1)
            self.history.append({"epoch": epoch + 1, "train_loss": tl / max(nb, 1), "val_loss": vl})
            if vl < best - 1e-4:
                best, bad = vl, 0
                best_state = {k: v.detach().cpu().clone() for k, v in self.net.state_dict().items()}
            else:
                bad += 1
                if bad >= self.cfg["patience"]:
                    break
        if best_state:
            self.net.load_state_dict(best_state)
        self.net.to(dev).eval()

    def scores(self, prefix: tuple[str, ...]) -> dict[str, float]:
        dev = next(self.net.parameters()).device
        ids = [self.vocab.stoi[BOS]] + self.vocab.encode(prefix)
        with torch.no_grad():
            logits = self.net(torch.tensor([ids], device=dev))[0, -1]
            probs = torch.softmax(logits, -1).cpu().tolist()
        return {s: probs[i] for i, s in enumerate(self.vocab.itos) if i >= 2}  # skip PAD, BOS

    # -- persistence: <path>.json (meta) + <path>.pt (weights)
    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.with_suffix(".json").write_text(json.dumps({"type": self.name, "cfg": self.cfg,
                                                          "itos": self.vocab.itos, "history": self.history}),
                                             encoding="utf-8")
        torch.save(self.net.state_dict(), path.with_suffix(".pt"))

    @classmethod
    def load(cls, path: str | Path) -> "GRUPredictor":
        path = Path(path)
        meta = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
        m = cls(**meta["cfg"])
        m.vocab = SymbolVocab([]); m.vocab.itos = meta["itos"]; m.vocab.stoi = {s: i for i, s in enumerate(meta["itos"])}
        m.net = _GRUNet(len(m.vocab), m.cfg["emb"], m.cfg["hidden"], m.cfg["layers"], m.cfg["dropout"])
        m.net.load_state_dict(torch.load(path.with_suffix(".pt"), map_location="cpu"))
        m.net.to(_device()).eval()
        m.history = meta.get("history", [])
        return m

    def export_onnx(self, path: str | Path) -> None:
        """Export for onnxruntime-web; input int64 (1, T) symbol ids, output (1, T, V) logits."""
        self.net.eval()
        net = self.net.to("cpu")
        dummy = torch.tensor([[1, 3, 4]], dtype=torch.long)
        torch.onnx.export(net, (dummy,), str(path), input_names=["ids"], output_names=["logits"],
                          dynamic_axes={"ids": {1: "T"}, "logits": {1: "T"}}, opset_version=17,
                          dynamo=False)
        Path(path).with_suffix(".vocab.json").write_text(json.dumps(self.vocab.itos), encoding="utf-8")
        self.net.to(_device())


# ---- transformer --------------------------------------------------------------------------
class TransformerPredictor(Predictor):
    """Encoder (KinyaBERT / AfriBERTa via Hugging Face) + linear head at the mask position."""

    name = "transformer"

    def __init__(self, model_name: str = "castorini/afriberta_small", lexical: dict[str, str] | None = None,
                 lr: float = 3e-5, batch_size: int = 32, epochs: int = 5, patience: int = 2,
                 max_len: int = 48, seed: int = 0, tokenizer=None, encoder=None):
        self.cfg = dict(model_name=model_name, lr=lr, batch_size=batch_size, epochs=epochs,
                        patience=patience, max_len=max_len, seed=seed)
        self.lexical = lexical or {}
        self.vocab: SymbolVocab | None = None
        self.tok = tokenizer
        self.enc = encoder
        self.head: nn.Linear | None = None
        self.history: list[dict] = []

    def _ensure_backbone(self):
        if self.tok is None or self.enc is None:
            from transformers import AutoModel, AutoTokenizer
            self.tok = AutoTokenizer.from_pretrained(self.cfg["model_name"])
            self.enc = AutoModel.from_pretrained(self.cfg["model_name"])
        if self.tok.mask_token is None:
            raise ValueError("tokenizer has no mask token; a masked-LM checkpoint is required")

    def _text(self, prefix: tuple[str, ...]) -> str:
        words = [self.lexical.get(s, s.lower().replace("_", " ")) for s in prefix]
        return " ".join(words + [self.tok.mask_token])

    def _encode(self, prefixes: list[tuple[str, ...]], dev):
        batch = self.tok([self._text(p) for p in prefixes], padding=True, truncation=True,
                         max_length=self.cfg["max_len"], return_tensors="pt")
        return {k: v.to(dev) for k, v in batch.items()}

    def _mask_states(self, batch) -> torch.Tensor:
        out = self.enc(**batch).last_hidden_state
        ids = batch["input_ids"]
        pos = (ids == self.tok.mask_token_id).float().argmax(dim=1)  # first mask per row
        return out[torch.arange(out.size(0), device=out.device), pos]

    @staticmethod
    def _examples(seqs):
        for s in seqs:
            for i in range(len(s) + 1):
                yield tuple(s[:i]), (s[i] if i < len(s) else EOS)

    def fit(self, sequences, val_sequences=None, symbols: list[str] | None = None) -> None:
        _seed(self.cfg["seed"])
        self._ensure_backbone()
        self.vocab = SymbolVocab([s for seq in sequences for s in seq] + list(symbols or []))
        dev = _device()
        self.enc.to(dev)
        self.head = nn.Linear(self.enc.config.hidden_size, len(self.vocab)).to(dev)
        params = list(self.enc.parameters()) + list(self.head.parameters())
        opt = torch.optim.AdamW(params, lr=self.cfg["lr"])
        crit = nn.CrossEntropyLoss()
        train = list(self._examples(sequences))
        val = list(self._examples(val_sequences)) if val_sequences else None
        bs = self.cfg["batch_size"]
        best, best_state, bad = math.inf, None, 0
        for epoch in range(self.cfg["epochs"]):
            random.shuffle(train)
            self.enc.train(); self.head.train(); tl = 0.0; nb = 0
            for i in range(0, len(train), bs):
                chunk = train[i:i + bs]
                batch = self._encode([p for p, _ in chunk], dev)
                y = torch.tensor([self.vocab.stoi.get(t, 0) for _, t in chunk], device=dev)
                opt.zero_grad()
                loss = crit(self.head(self._mask_states(batch)), y)
                loss.backward(); nn.utils.clip_grad_norm_(params, 1.0); opt.step()
                tl += loss.item(); nb += 1
            vl = self._eval_loss(val, dev) if val else tl / max(nb, 1)
            self.history.append({"epoch": epoch + 1, "train_loss": tl / max(nb, 1), "val_loss": vl})
            if vl < best - 1e-4:
                best, bad = vl, 0
                best_state = ({k: v.detach().cpu().clone() for k, v in self.enc.state_dict().items()},
                              {k: v.detach().cpu().clone() for k, v in self.head.state_dict().items()})
            else:
                bad += 1
                if bad >= self.cfg["patience"]:
                    break
        if best_state:
            self.enc.load_state_dict(best_state[0]); self.head.load_state_dict(best_state[1])
        self.enc.to(dev).eval(); self.head.to(dev).eval()

    def _eval_loss(self, examples, dev) -> float:
        self.enc.eval(); self.head.eval(); crit = nn.CrossEntropyLoss(reduction="sum"); tot = 0.0
        bs = self.cfg["batch_size"]
        with torch.no_grad():
            for i in range(0, len(examples), bs):
                chunk = examples[i:i + bs]
                batch = self._encode([p for p, _ in chunk], dev)
                y = torch.tensor([self.vocab.stoi.get(t, 0) for _, t in chunk], device=dev)
                logits = self.head(self._mask_states(batch))
                keep = y != 0  # targets outside the vocabulary are reported by metrics, not scored here
                if keep.any():
                    tot += crit(logits[keep], y[keep]).item()
        return tot / max(len(examples), 1)

    def scores(self, prefix: tuple[str, ...]) -> dict[str, float]:
        dev = next(self.head.parameters()).device
        with torch.no_grad():
            probs = torch.softmax(self.head(self._mask_states(self._encode([prefix], dev)))[0], -1).cpu().tolist()
        return {s: probs[i] for i, s in enumerate(self.vocab.itos) if i >= 2}

    def save(self, path: str | Path) -> None:
        path = Path(path); path.mkdir(parents=True, exist_ok=True)
        self.enc.save_pretrained(path / "encoder"); self.tok.save_pretrained(path / "encoder")
        torch.save(self.head.state_dict(), path / "head.pt")
        (path / "meta.json").write_text(json.dumps({"type": self.name, "cfg": self.cfg, "itos": self.vocab.itos,
                                                    "lexical": self.lexical, "history": self.history}),
                                        encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "TransformerPredictor":
        from transformers import AutoModel, AutoTokenizer
        path = Path(path)
        meta = json.loads((path / "meta.json").read_text(encoding="utf-8"))
        m = cls(lexical=meta["lexical"], **meta["cfg"])
        m.tok = AutoTokenizer.from_pretrained(path / "encoder"); m.enc = AutoModel.from_pretrained(path / "encoder")
        m.vocab = SymbolVocab([]); m.vocab.itos = meta["itos"]; m.vocab.stoi = {s: i for i, s in enumerate(meta["itos"])}
        m.head = nn.Linear(m.enc.config.hidden_size, len(m.vocab))
        m.head.load_state_dict(torch.load(path / "head.pt", map_location="cpu"))
        dev = _device(); m.enc.to(dev).eval(); m.head.to(dev).eval(); m.history = meta.get("history", [])
        return m

    def parameter_count(self) -> int:
        return sum(p.numel() for p in self.enc.parameters()) + sum(p.numel() for p in self.head.parameters())
