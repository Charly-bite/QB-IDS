FROM python:3.12-slim

# Install nmap + SNMP tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends nmap curl snmp && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 5000

CMD ["python", "app.py"]
