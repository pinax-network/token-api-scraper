# Docker Guide

This document provides comprehensive information about running the Token API Scraper in Docker containers.

## Overview

The project includes a Dockerfile for running the CLI in a containerized environment. This enables:
- Consistent deployment across environments
- Easy integration with container orchestration platforms
- Isolated runtime environment
- Simple dependency management

## Building the Docker Image

### Basic Build

```bash
docker build -t token-api-scraper .
```

### Build with Custom Tag

```bash
docker build -t myorg/token-api-scraper:v1.0.0 .
```

### Build Arguments

The Dockerfile supports standard Docker build arguments:

```bash
# Build with specific base image
docker build --build-arg NODE_VERSION=20 -t token-api-scraper .
```

## Running with Docker

### Basic Commands

```bash
# Show help
docker run token-api-scraper help

# List available services
docker run token-api-scraper list

# Show version
docker run token-api-scraper version
```

### Running Services

#### Metadata Service

```bash
docker run \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  -e CLICKHOUSE_USERNAME=default \
  -e CLICKHOUSE_PASSWORD=password \
  -e NODE_URL=https://tron-evm-rpc.publicnode.com \
  -e CONCURRENCY=10 \
  token-api-scraper run metadata
```

## Docker Compose

```bash
# ERC-20 backfill
docker run \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  -e CONCURRENCY=15 \
  token-api-scraper run erc20-backfill

# Native backfill
docker run \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  -e CONCURRENCY=15 \
  token-api-scraper run native-backfill
```

### Using Command-Line Flags

Command-line flags override environment variables:

```bash
docker run token-api-scraper run erc20-balances \
  --clickhouse-url http://clickhouse:8123 \
  --concurrency 20 \
  --enable-prometheus \
  --prometheus-port 9090
```

### Database Setup

```bash
# Setup database schema
docker run \
  -v $(pwd)/sql:/app/sql \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  token-api-scraper setup sql/schema.metadata.sql

# Setup with cluster
docker run \
  -v $(pwd)/sql:/app/sql \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  token-api-scraper setup sql/schema.*.sql --cluster my_cluster
```

## Docker Compose

### Basic Setup

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  # Metadata scraper
  metadata-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=10
    command: run metadata
    restart: unless-stopped
```

Run with:
```bash
docker-compose up -d
```

### Complete Setup

```yaml
version: '3.8'

services:
  # Incremental services
  metadata-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=10
    command: run metadata
    restart: unless-stopped

  erc20-balances-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=10
    command: run erc20-balances
    restart: unless-stopped

  native-balances-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=10
    command: run native-balances
    restart: unless-stopped

  # Backfill services
  erc20-backfill-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=15
    command: run erc20-backfill
    restart: "no"  # Don't restart - backfill completes eventually

  native-backfill-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=15
    command: run native-backfill
    restart: "no"  # Don't restart - backfill completes eventually
```

### With Prometheus Monitoring

```yaml
version: '3.8'

services:
  erc20-balances-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=10
      - PROMETHEUS_PORT=9090
    command: run erc20-balances
    ports:
      - "9090:9090"  # Expose Prometheus metrics
    restart: unless-stopped

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
    ports:
      - "9091:9090"
    restart: unless-stopped

volumes:
  prometheus-data:
```

Create `prometheus.yml`:
```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'token-scraper'
    static_configs:
      - targets: ['metadata-scraper:9090']
```

## Environment Variables

See [CONFIGURATION.md](./CONFIGURATION.md) for detailed information about all environment variables.

### Common Variables for Docker

```bash
# Database
CLICKHOUSE_URL=http://clickhouse:8123
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=password
CLICKHOUSE_DATABASE=default

# RPC
NODE_URL=https://tron-evm-rpc.publicnode.com

# Performance
CONCURRENCY=10
MAX_RETRIES=3

# Monitoring
PROMETHEUS_PORT=9090
```

### Using .env File with Docker Compose

Create a `.env` file and reference it in `docker-compose.yml`:

```yaml
services:
  metadata-scraper:
    build: .
    env_file:
      - .env
    command: run metadata
```

## Networking

### Container Networking

When running multiple containers:

```yaml
version: '3.8'

networks:
  scraper-network:
    driver: bridge

services:
  clickhouse:
    image: clickhouse/clickhouse-server:latest
    networks:
      - scraper-network
    ports:
      - "8123:8123"

  metadata-scraper:
    build: .
    networks:
      - scraper-network
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
    command: run metadata
```

### External Database

To connect to an external ClickHouse instance:

```yaml
services:
  metadata-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://external-clickhouse.example.com:8123
    command: run metadata
    network_mode: bridge
```

## Volume Mounts

### Mounting SQL Files

For database setup, mount SQL schema files:

```bash
docker run \
  -v $(pwd)/sql:/app/sql \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  token-api-scraper setup sql/schema.*.sql
```

### Mounting Configuration

```bash
docker run \
  -v $(pwd)/.env:/app/.env \
  token-api-scraper run metadata
```

### Logs and Data

```yaml
services:
  metadata-scraper:
    build: .
    volumes:
      - ./logs:/app/logs
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
    command: run metadata
```

## Health Checks

### Container Health Check

Add health checks to your services:

```yaml
services:
  erc20-balances-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - PROMETHEUS_PORT=9090
    command: run erc20-balances
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9090/metrics"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Dependency Management

Ensure ClickHouse is ready before starting scrapers:

```yaml
services:
  clickhouse:
    image: clickhouse/clickhouse-server:latest
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8123/ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  metadata-scraper:
    build: .
    depends_on:
      clickhouse:
        condition: service_healthy
    command: run metadata
```

## Logging

### View Logs

```bash
# View logs from all services
docker-compose logs -f

# View logs from specific service
docker-compose logs -f metadata-scraper

# View last 100 lines
docker-compose logs --tail=100 erc20-balances-scraper
```

### Log Configuration

Configure logging in `docker-compose.yml`:

```yaml
services:
  metadata-scraper:
    build: .
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    command: run metadata
```

## Resource Limits

### CPU and Memory Limits

```yaml
services:
  erc20-balances-scraper:
    build: .
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          cpus: '1.0'
          memory: 1G
    command: run erc20-balances
```

### Scaling

```bash
# Scale up to 3 instances
docker-compose up -d --scale erc20-backfill-scraper=3

# Scale down to 1 instance
docker-compose up -d --scale erc20-backfill-scraper=1
```

## Production Deployment

### Best Practices

1. **Use specific image tags**:
   ```bash
   docker build -t token-api-scraper:1.0.0 .
   ```

2. **Set restart policies**:
   ```yaml
   restart: unless-stopped
   ```

3. **Configure Prometheus port (Prometheus is always enabled)**:
   ```yaml
   environment:
     - PROMETHEUS_PORT=9090
   ```

4. **Configure resource limits**:
   ```yaml
   deploy:
     resources:
       limits:
         memory: 2G
   ```

5. **Use health checks**:
   ```yaml
   healthcheck:
     test: ["CMD", "curl", "-f", "http://localhost:9090/metrics"]
   ```

### Example Production Configuration

```yaml
version: '3.8'

services:
  erc20-balances-scraper:
    image: token-api-scraper:1.0.0
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=${DB_USERNAME}
      - CLICKHOUSE_PASSWORD=${DB_PASSWORD}
      - CLICKHOUSE_DATABASE=production_evm
      - NODE_URL=https://your-tron-node.example.com
      - CONCURRENCY=20
      - MAX_RETRIES=5
      - PROMETHEUS_PORT=9090
    command: run erc20-balances
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          cpus: '1.0'
          memory: 1G
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9090/metrics"]
      interval: 30s
      timeout: 10s
      retries: 3
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "5"
```

## Troubleshooting

### Container Won't Start

```bash
# Check container logs
docker logs <container-id>

# Check container status
docker ps -a

# Inspect container
docker inspect <container-id>
```

### Network Issues

```bash
# Test ClickHouse connectivity from within container
docker run --rm token-api-scraper sh -c "curl http://clickhouse:8123/ping"

# Check network
docker network ls
docker network inspect <network-name>
```

### Database Connection Issues

```bash
# Test database connection
docker run \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  token-api-scraper setup sql/schema.metadata.sql
```

### Performance Issues

```bash
# Check resource usage
docker stats

# Check container limits
docker inspect <container-id> | grep -A 10 Resources
```

## Kubernetes Deployment

For Kubernetes deployments, see the example manifests in the `/k8s` directory (if available) or create your own based on these Docker configurations.

Example minimal Kubernetes deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: erc20-balances-scraper
spec:
  replicas: 1
  selector:
    matchLabels:
      app: erc20-balances-scraper
  template:
    metadata:
      labels:
        app: erc20-balances-scraper
    spec:
      containers:
      - name: scraper
        image: token-api-scraper:1.0.0
        command: ["node", "cli.js", "run", "erc20-balances"]
        env:
        - name: CLICKHOUSE_URL
          value: "http://clickhouse:8123"
        - name: CONCURRENCY
          value: "10"
        resources:
          limits:
            memory: "2Gi"
            cpu: "2000m"
          requests:
            memory: "1Gi"
            cpu: "1000m"
```
