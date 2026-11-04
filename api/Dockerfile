FROM python:3.11-slim
WORKDIR /srv
COPY api/pyproject.toml api/
COPY api/app api/app
COPY ml/pyproject.toml ml/
COPY ml/vuga_ml ml/vuga_ml
COPY ml/artifacts/kn_trigram.json ml/artifacts/kn_trigram.json
COPY vocab/symbols.csv vocab/symbols.csv
RUN pip install --no-cache-dir ./api ./ml
WORKDIR /srv/api
ENV VUGA_MODEL_DIR=/srv/ml/artifacts
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
