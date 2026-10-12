"""Execute and render the model notebook using the active Python environment."""
from __future__ import annotations

import os
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from nbconvert import HTMLExporter


def main() -> None:
    folder = Path(__file__).resolve().parent
    repo = folder.parents[1]
    # Keep caches and Jupyter runtime files in the workspace, including on restricted hosts.
    runtime = repo / ".venv" / "notebook-runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("JUPYTER_RUNTIME_DIR", str(runtime))
    os.environ.setdefault("JUPYTER_CONFIG_DIR", str(runtime / "config"))
    os.environ.setdefault("IPYTHONDIR", str(runtime / "ipython"))
    os.environ.setdefault("MPLCONFIGDIR", str(runtime / "matplotlib"))
    notebook_path = folder / "vuga_model.ipynb"
    notebook = nbformat.read(notebook_path, as_version=4)
    client = NotebookClient(notebook, timeout=180, kernel_name="python3",
                            resources={"metadata": {"path": str(repo)}})
    client.execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, notebook_path)
    html, _ = HTMLExporter().from_notebook_node(notebook)
    html_path = folder / "vuga_model.html"
    html_path.write_text(html, encoding="utf-8")
    code_cells = [cell for cell in notebook.cells if cell.cell_type == "code"]
    print(f"Executed {len(code_cells)} code cells without errors.")
    print(f"Notebook: {notebook_path.relative_to(repo)}")
    print(f"HTML: {html_path.relative_to(repo)}")


if __name__ == "__main__":
    main()
