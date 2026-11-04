FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv poppler-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY requirements.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY . ./
RUN python3 fetch-models.py && useradd --create-home --uid 10001 mana && chown -R mana:mana /app
USER mana
ENV MANA_OCR_WORKERS=4 MANA_OCR_DEVICE=cpu PYTHONUNBUFFERED=1
CMD ["/opt/venv/bin/python", "-u", "handler.py"]
