from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "BotPrimeX Backend"
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
    smtp_from: str = "no-reply@botprimex.com"
    smtp_starttls: bool = False
    smtp_ssl: bool = False

    reset_token_ttl_minutes: int = 30

    # Bot API connections (comma-separated for multiple bots)
    freqtrade_urls: str = "http://localhost:8001"
    freqtrade_usernames: str = "admin"
    freqtrade_passwords: str = "admin"
    freqtrade_bot_ids: str = ""
    freqtrade_bot_names: str = ""

    # Hetzner provisioning
    hetzner_api_token: str = ""
    hetzner_datacenter: str = "nbg1-dc3"
    hetzner_server_type: str = "cx22"
    hetzner_image: str = "ubuntu-22.04"
    hetzner_ssh_keys: str = ""
    hetzner_root_password: str = ""

    # Remote deployment automation
    deploy_ssh_user: str = "root"
    deploy_ssh_port: int = 22
    deploy_ssh_private_key_path: str = ""
    freqtrade_deploy_dir: str = "/opt/botprimex-freqtrade"
    freqtrade_deploy_image: str = "freqtradeorg/freqtrade:stable"
    freqtrade_deploy_api_port: int = 18080

    model_config = SettingsConfigDict(env_file=".env", env_prefix="BACKEND_")


settings = Settings()
