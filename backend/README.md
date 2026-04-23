# AISCL Backend

FastAPI backend for AISCL Collaborative Learning System.

详细（Behavior Stream）与精简（Activity Logs）

## Setup

1. Install Poetry: `curl -sSL https://install.python-poetry.org | python3 -`

2. Install dependencies:
```bash
poetry install
```

3. Activate virtual environment:
```bash
poetry shell
```

4. Run development server:
```bash
poetry run uvicorn app.main:app --reload
```

5. Build and run backend:
```bash
docker-compose up -d --build backend
```

6. Build and run frontend:
```bash
docker-compose up -d --build frontend
```

7. Create test users:
```bash
docker-compose exec backend python create_test_users.py
```

## Testing

```bash
poetry run pytest
```

## Code Quality

```bash
# Format code
poetry run black .
poetry run isort .

# Lint
poetry run pylint app
```

