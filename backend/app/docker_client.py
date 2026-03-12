from docker import DockerClient
from docker.errors import DockerException

from .settings import settings


def get_docker_client() -> DockerClient:
    return DockerClient(base_url=settings.docker_socket)


def safe_docker_ping() -> tuple[bool, str]:
    try:
        client = get_docker_client()
        ok = client.ping()
        return bool(ok), "Docker daemon reachable"
    except DockerException as exc:
        return False, str(exc)
