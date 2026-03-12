from hashlib import scrypt
from hmac import compare_digest
from secrets import token_hex


def hash_password(password: str) -> str:
    salt = token_hex(16)
    password_hash = scrypt(password.encode("utf-8"), salt=salt.encode("utf-8"), n=2**14, r=8, p=1).hex()
    return f"{salt}:{password_hash}"


def verify_password(password: str, stored_hash: str) -> bool:
    salt, password_hash = stored_hash.split(":", 1)
    candidate_hash = scrypt(password.encode("utf-8"), salt=salt.encode("utf-8"), n=2**14, r=8, p=1).hex()
    return compare_digest(candidate_hash, password_hash)