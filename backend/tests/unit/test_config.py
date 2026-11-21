from __future__ import annotations

import pytest
from pydantic import ValidationError

from tests.conftest import make_settings


def test_supabase_url_normalised_to_asyncpg() -> None:
    s = make_settings(database_url="postgresql://u:p@host:5432/postgres")
    assert s.database_url is not None
    assert s.database_url.get_secret_value() == "postgresql+asyncpg://u:p@host:5432/postgres"


def test_database_url_is_secret_in_repr() -> None:
    s = make_settings(database_url="postgresql://u:topsecret@host/db")
    assert "topsecret" not in repr(s)


def test_cors_origins_parsed_from_comma_string() -> None:
    s = make_settings(cors_origins="https://a.example.edu, https://b.example.edu/")
    assert s.cors_origins == ["https://a.example.edu", "https://b.example.edu"]


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"database_url": None}, "DATABASE_URL"),
        ({"database_ssl": False}, "DATABASE_SSL"),
        ({"cors_origins": []}, "CORS_ORIGINS must list"),
        ({"cors_origins": ["*"]}, "no '*'"),
        ({"cors_origins": ["http://insecure.example.edu"]}, "https://"),
    ],
)
def test_production_config_is_validated(overrides: dict[str, object], fragment: str) -> None:
    base: dict[str, object] = {
        "environment": "production",
        "database_url": "postgresql://u:p@host/db",
        "database_ssl": True,
        "cors_origins": ["https://papermark.example.edu"],
    }
    base.update(overrides)
    with pytest.raises(ValidationError, match=fragment):
        make_settings(**base)


def test_valid_production_config() -> None:
    s = make_settings(
        environment="production",
        database_url="postgresql://u:p@host/db",
        database_ssl=True,
        cors_origins=["https://papermark.example.edu"],
    )
    assert s.is_production
    assert s.ai_provider == "none"
