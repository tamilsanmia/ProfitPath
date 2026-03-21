import smtplib
import logging
from email.message import EmailMessage
from typing import Any

from .settings import settings


logger = logging.getLogger("profitpath.mailer")


def send_test_email(to_email: str, smtp_config: dict[str, Any]) -> None:
    """
    Send a test email using provided SMTP configuration.
    
    Args:
        to_email: Recipient email address
        smtp_config: Dictionary containing SMTP settings:
            - host: SMTP host
            - port: SMTP port
            - encryption: "TLS", "SSL", or "None"
            - username: SMTP username (optional)
            - password: SMTP password (optional)
            - fromEmail: From address
            - fromName: From name (optional)
            - charset: Email charset (default: UTF-8)
    """
    host = str(smtp_config.get("host", "")).strip()
    port = int(smtp_config.get("port", 587))
    encryption = str(smtp_config.get("encryption", "TLS")).strip().upper()
    username = str(smtp_config.get("username", "")).strip()
    password = str(smtp_config.get("password", "")).strip()
    from_email = str(smtp_config.get("fromEmail", "")).strip()
    from_name = str(smtp_config.get("fromName", "")).strip()
    charset = str(smtp_config.get("charset", "UTF-8")).strip()
    
    if not host:
        raise ValueError("SMTP host is required")
    if not from_email:
        raise ValueError("From email is required")

    logger.warning(
        "test_email_send_start to=%s host=%s port=%s encryption=%s username_present=%s",
        to_email,
        host,
        port,
        encryption,
        bool(username),
    )
    
    display_from = f"{from_name} <{from_email}>" if from_name else from_email
    
    subject = "ProfitPath Email Configuration Test"
    body = (
        "This is a test email from ProfitPath.\n\n"
        "If you received this email, your SMTP settings are configured correctly.\n\n"
        "Best regards,\n"
        "ProfitPath Team"
    )
    
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = display_from
    message["To"] = to_email
    message.set_content(body, charset=charset)
    
    try:
        if encryption == "SSL":
            with smtplib.SMTP_SSL(host, port, timeout=10) as smtp:
                if username and password:
                    smtp.login(username, password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=10) as smtp:
                if encryption == "TLS":
                    smtp.starttls()
                if username and password:
                    smtp.login(username, password)
                smtp.send_message(message)
        logger.warning("test_email_send_success to=%s host=%s port=%s", to_email, host, port)
    except smtplib.SMTPAuthenticationError as e:
        logger.exception("test_email_send_auth_failed to=%s host=%s port=%s", to_email, host, port)
        raise ValueError(f"SMTP authentication failed: {str(e)}")
    except smtplib.SMTPException as e:
        logger.exception("test_email_send_smtp_error to=%s host=%s port=%s", to_email, host, port)
        raise ValueError(f"SMTP error: {str(e)}")
    except Exception as e:
        logger.exception("test_email_send_failed to=%s host=%s port=%s", to_email, host, port)
        raise ValueError(f"Failed to send email: {str(e)}")


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
