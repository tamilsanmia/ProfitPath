import smtplib
from email.message import EmailMessage

from .settings import settings


def send_reset_email(to_email: str, reset_link: str) -> None:
    subject = "Reset your ProfitPath password"
    body = (
        "We received a request to reset your password.\n\n"
        f"Reset link: {reset_link}\n\n"
        f"This link expires in {settings.reset_token_ttl_minutes} minutes.\n"
        "If you did not request this, please ignore this email."
    )

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = to_email
    message.set_content(body)

    if settings.smtp_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(message)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message)
