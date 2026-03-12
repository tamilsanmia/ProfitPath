from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ProfitPath Backend"
    docker_socket: str = "unix://var/run/docker.sock"
    postgres_url: str = "postgresql://postgres:postgres@postgres:5432/profitpath"
    redis_url: str = "redis://redis:6379/0"
    frontend_url: str = "http://localhost:3000"
    public_base_url: str = "http://localhost:8000"
    profile_pictures_dir: str = "/app/storage/profile-pictures"
    google_client_id: str = ""
    settings_encryption_key: str = ""

    smtp_host: str = "mailpit"
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "no-reply@profitpath.local"
    smtp_starttls: bool = False
    smtp_ssl: bool = False

    reset_token_ttl_minutes: int = 30

    model_config = SettingsConfigDict(env_file=".env", env_prefix="BACKEND_")


settings = Settings()
