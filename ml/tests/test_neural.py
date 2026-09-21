"""Tiny CPU-sized checks that the neural code paths train, predict, persist and export."""
import json
import math
import os
import random

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
import pytest

torch = pytest.importorskip("torch")

from vuga_ml import EOS
from vuga_ml.metrics import aggregate, score_sequence
from vuga_ml.models.neural import GRUPredictor, TransformerPredictor

SYMS = ["I", "YOU", "WANT", "EAT", "DRINK", "WATER", "MILK", "PLAY", "BALL", "NOT"]


def toy_data(n=400, seed=0):
    rng = random.Random(seed); seqs = []
    for _ in range(n):
        subj = rng.choice(["I", "YOU"]); verb = rng.choice(["WANT", "EAT", "DRINK", "PLAY"])
        obj = {"EAT": "WATER", "DRINK": "MILK", "PLAY": "BALL", "WANT": rng.choice(["WATER", "MILK", "BALL"])}[verb]
        seq = [subj] + (["NOT"] if rng.random() < 0.2 else []) + [verb, obj]
        seqs.append(tuple(seq))
    return seqs


def test_gru_learns_toy_grammar(tmp_path):
    train, val = toy_data(400), toy_data(80, seed=1)
    m = GRUPredictor(emb=16, hidden=32, epochs=15, patience=5, batch_size=32, seed=0)
    m.fit(train, val)
    dist = m.predict(("I", "EAT"))
    assert math.isclose(sum(dist.values()), 1.0, rel_tol=1e-6) and EOS in dist
    assert m.top_k(("I", "EAT"), 1) == ["WATER"]
    agg = aggregate([score_sequence(m, s) for s in val])
    assert agg["top3"] > 0.8
    m.save(tmp_path / "gru")
    m2 = GRUPredictor.load(tmp_path / "gru")
    assert m2.top_k(("YOU", "PLAY"), 1) == ["BALL"]
    m.export_onnx(tmp_path / "gru.onnx")
    assert (tmp_path / "gru.onnx").exists() and json.loads((tmp_path / "gru.vocab.json").read_text())[1] == "<s>"


def test_gru_onnx_matches_torch(tmp_path):
    pytest.importorskip("onnxruntime")
    import numpy as np
    import onnxruntime as ort
    m = GRUPredictor(emb=8, hidden=16, epochs=2, batch_size=32, seed=0)
    m.fit(toy_data(100))
    m.export_onnx(tmp_path / "g.onnx")
    sess = ort.InferenceSession(str(tmp_path / "g.onnx"), providers=["CPUExecutionProvider"])
    ids = np.array([[1] + m.vocab.encode(("I", "WANT"))], dtype=np.int64)
    logits = sess.run(None, {"ids": ids})[0][0, -1]
    onnx_probs = np.exp(logits - logits.max()); onnx_probs /= onnx_probs.sum()
    torch_dist = m.scores(("I", "WANT"))
    for i, s in enumerate(m.vocab.itos):
        if i >= 2:
            assert abs(onnx_probs[i] / onnx_probs[2:].sum() - torch_dist[s] / sum(torch_dist.values())) < 1e-4


def _tiny_bert(tmp_path):
    """Random-init BERT with a WordLevel tokenizer over the toy lexical forms (no download)."""
    from tokenizers import Tokenizer, models, pre_tokenizers
    from transformers import BertConfig, BertModel, PreTrainedTokenizerFast
    words = ["njye", "wowe", "gushaka", "kurya", "kunywa", "amazi", "amata", "gukina", "umupira", "ntabwo"]
    vocab = {w: i for i, w in enumerate(["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"] + words)}
    core = Tokenizer(models.WordLevel(vocab, unk_token="[UNK]"))
    core.pre_tokenizer = pre_tokenizers.Whitespace()
    tok = PreTrainedTokenizerFast(tokenizer_object=core, pad_token="[PAD]", unk_token="[UNK]",
                                  cls_token="[CLS]", sep_token="[SEP]", mask_token="[MASK]")
    cfg = BertConfig(vocab_size=len(vocab), hidden_size=32, num_hidden_layers=2, num_attention_heads=2,
                     intermediate_size=64, max_position_embeddings=32)
    return tok, BertModel(cfg)


def test_transformer_path_trains_and_persists(tmp_path):
    tok, enc = _tiny_bert(tmp_path)
    lexical = dict(zip(SYMS, ["njye", "wowe", "gushaka", "kurya", "kunywa", "amazi", "amata", "gukina", "umupira", "ntabwo"]))
    m = TransformerPredictor(lexical=lexical, tokenizer=tok, encoder=enc, lr=1e-3, batch_size=32, epochs=6,
                             patience=6, seed=0)
    train, val = toy_data(200), toy_data(40, seed=2)
    m.fit(train, val)
    dist = m.predict(("I", "DRINK"))
    assert math.isclose(sum(dist.values()), 1.0, rel_tol=1e-6)
    assert m.top_k(("I", "DRINK"), 1) == ["MILK"]
    assert m.history[-1]["val_loss"] < m.history[0]["val_loss"]
    m.save(tmp_path / "tf")
    m2 = TransformerPredictor.load(tmp_path / "tf")
    assert m2.top_k(("YOU", "PLAY"), 1) == ["BALL"]
