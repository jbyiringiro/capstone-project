FROM python:3.11-slim
WORKDIR /srv
COPY api/pyproject.toml api/
COPY ml/ ml/
COPY vocab/ vocab/
RUN pip install --no-cache-dir ./api ./ml
COPY api/app api/app
WORKDIR /srv/api
ENV VUGA_MODEL_DIR=/srv/ml/artifacts
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
