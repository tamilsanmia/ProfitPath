import smtplib
import logging
import html
from email.message import EmailMessage
from typing import Any

from .settings import settings


logger = logging.getLogger("profitpath.mailer")


DEFAULT_PREDEFINED_HEADER = """<!DOCTYPE html>
<html>
<head>
    <meta name=\"viewport\" content=\"width=device-width\" />
    <meta http-equiv=\"Content-Type\" content=\"text/html; charset=UTF-8\" />
    <style>
        body {
            background-color: #f6f6f6;
            font-family: sans-serif;
            -webkit-font-smoothing: antialiased;
            font-size: 14px;
            line-height: 1.4;
            margin: 0;
            padding: 0;
            -ms-text-size-adjust: 100%;
            -webkit-text-size-adjust: 100%;
        }
        table {
            border-collapse: separate;
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
            width: 100%;
        }
        table td {
            font-family: sans-serif;
            font-size: 14px;
            vertical-align: top;
        }
        .body {
            background-color: #f6f6f6;
            width: 100%;
        }
        .container {
            display: block;
            margin: 0 auto !important;
            max-width: 680px;
            padding: 10px;
            width: 680px;
        }
        .content {
            box-sizing: border-box;
            display: block;
            margin: 0 auto;
            max-width: 680px;
            padding: 10px;
        }
        .main {
            background: #fff;
            border-radius: 3px;
            width: 100%;
        }
        .header {
            text-align: center;
            padding: 10px;
            border-radius: 8px 8px 0 0;
            background: transparent;
        }
        .header img {
            max-width: 150px;
        }
        .wrapper {
            box-sizing: border-box;
            padding: 20px;
            color: #222222;
        }
        .footer {
            clear: both;
            padding-top: 10px;
            text-align: center;
            width: 100%;
        }
        .footer td, .footer p, .footer span, .footer a {
            color: #999999;
            font-size: 12px;
            text-align: center;
        }
        hr {
            border: 0;
            border-bottom: 1px solid #f6f6f6;
            margin: 20px 0;
        }
        @media only screen and (max-width: 620px) {
            table[class=body] .content {
                padding: 0 !important;
            }
            table[class=body] .container {
                padding: 0 !important;
                width: 100% !important;
            }
            table[class=body] .main {
                border-left-width: 0 !important;
                border-radius: 0 !important;
                border-right-width: 0 !important;
            }
        }
    </style>
</head>
<body>
    <table border=\"0\" cellpadding=\"0\" cellspacing=\"0\" class=\"body\">
        <tr>
            <td>&nbsp;</td>
            <td class=\"container\">
                <div class=\"content\">
                    <div class=\"header\">
                        <table border=\"0\" cellpadding=\"0\" cellspacing=\"0\">
                            <tr>
                                <td class=\"header\">
                                    <img src=\"{logo_url}\" alt=\"{companyname} Logo\">
                                </td>
                            </tr>
                        </table>
                    </div>
                    <table class=\"main\">
                        <tr>
                            <td class=\"wrapper\">
                                <table border=\"0\" cellpadding=\"0\" cellspacing=\"0\">
                                    <tr>
                                        <td>
"""

DEFAULT_PREDEFINED_FOOTER = """
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                    <div class=\"footer\">
                        <table border=\"0\" cellpadding=\"0\" cellspacing=\"0\">
                            <tr>
                                <td class=\"content-block\">
                                    <span>&copy; 2025 {companyname}. All rights reserved.</span>
                                </td>
                            </tr>
                        </table>
                    </div>
                </div>
            </td>
            <td>&nbsp;</td>
        </tr>
    </table>
</body>
</html>
"""


def _apply_template_tokens(template: str, company_name: str, logo_url: str) -> str:
    return (
        template
        .replace("{companyname}", html.escape(company_name))
        .replace("{logo_url}", html.escape(logo_url))
    )


def _build_wrapped_html(content_html: str, config: dict[str, Any] | None = None) -> str:
    cfg = config or {}
    company_name = str(cfg.get("companyName") or "ProfitPath").strip() or "ProfitPath"
    logo_url = str(cfg.get("logoUrl") or "").strip()
    predefined_header = str(cfg.get("predefinedHeader") or "")
    predefined_footer = str(cfg.get("predefinedFooter") or "")

    header = _apply_template_tokens(predefined_header or DEFAULT_PREDEFINED_HEADER, company_name, logo_url)
    footer = _apply_template_tokens(predefined_footer or DEFAULT_PREDEFINED_FOOTER, company_name, logo_url)
    return f"{header}{content_html}{footer}"


def _build_notification_content_html(
    *,
    title: str,
    paragraphs: list[str],
    greeting: str | None = None,
    cta_label: str | None = None,
    cta_url: str | None = None,
) -> str:
    parts: list[str] = []

    if greeting:
        parts.append(
            "<p style=\"margin:0 0 14px; font-size:18px; font-weight:600; color:#111827; text-align:center;\">"
            f"{html.escape(greeting)}"
            "</p>"
        )
        parts.append("<hr>")

    parts.append(
        "<h1 style=\"margin:0 0 16px; font-size:32px; line-height:1.15; color:#0f172a; font-weight:700; text-align:center;\">"
        f"{html.escape(title)}"
        "</h1>"
    )

    for paragraph in paragraphs:
        parts.append(
            "<p style=\"margin:0 0 14px; font-size:16px; line-height:1.7; color:#334155;\">"
            f"{paragraph}"
            "</p>"
        )

    if cta_label and cta_url:
        safe_url = html.escape(cta_url)
        safe_label = html.escape(cta_label)
        parts.append(
            "<p style=\"margin:20px 0 10px; text-align:center;\">"
            f"<a href=\"{safe_url}\" style=\"display:inline-block; background:#0b63f6; color:#ffffff; text-decoration:none;"
            " padding:10px 18px; border-radius:6px; font-weight:600;\">"
            f"{safe_label}</a>"
            "</p>"
        )

    return "".join(parts)


def _resolve_smtp_runtime_config(smtp_config: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = smtp_config or {}
    if smtp_config is None:
        encryption = "SSL" if settings.smtp_ssl else "TLS" if settings.smtp_starttls else "None"
        cfg = {
            "host": settings.smtp_host,
            "port": settings.smtp_port,
            "encryption": encryption,
            "username": settings.smtp_user,
            "password": settings.smtp_password,
            "fromEmail": settings.smtp_from,
            "fromName": "",
            "charset": "UTF-8",
        }

    host = str(cfg.get("host", "")).strip()
    if not host:
        raise ValueError("SMTP host is required")

    from_email = str(cfg.get("fromEmail", "")).strip()
    if not from_email:
        raise ValueError("From email is required")

    try:
        port = int(cfg.get("port", 587))
    except (TypeError, ValueError):
        port = 587

    return {
        "host": host,
        "port": port,
        "encryption": str(cfg.get("encryption", "TLS")).strip().upper(),
        "username": str(cfg.get("username", "")).strip(),
        "password": str(cfg.get("password", "")).strip(),
        "fromEmail": from_email,
        "fromName": str(cfg.get("fromName", "")).strip(),
        "charset": str(cfg.get("charset", "UTF-8")).strip() or "UTF-8",
    }


def send_notification_email(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    title: str,
    paragraphs: list[str],
    greeting: str | None = None,
    cta_label: str | None = None,
    cta_url: str | None = None,
    smtp_config: dict[str, Any] | None = None,
) -> None:
    runtime_config = _resolve_smtp_runtime_config(smtp_config)

    content_html = _build_notification_content_html(
        title=title,
        paragraphs=paragraphs,
        greeting=greeting,
        cta_label=cta_label,
        cta_url=cta_url,
    )
    html_body = _build_wrapped_html(content_html, smtp_config)

    display_from = (
        f"{runtime_config['fromName']} <{runtime_config['fromEmail']}>"
        if runtime_config["fromName"]
        else runtime_config["fromEmail"]
    )

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = display_from
    message["To"] = to_email
    message.set_content(text_body, charset=runtime_config["charset"])
    message.add_alternative(html_body, subtype="html", charset=runtime_config["charset"])

    if runtime_config["encryption"] == "SSL":
        with smtplib.SMTP_SSL(runtime_config["host"], runtime_config["port"], timeout=10) as smtp:
            if runtime_config["username"] and runtime_config["password"]:
                smtp.login(runtime_config["username"], runtime_config["password"])
            smtp.send_message(message)
        return

    with smtplib.SMTP(runtime_config["host"], runtime_config["port"], timeout=10) as smtp:
        if runtime_config["encryption"] == "TLS":
            smtp.starttls()
        if runtime_config["username"] and runtime_config["password"]:
            smtp.login(runtime_config["username"], runtime_config["password"])
        smtp.send_message(message)


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
    runtime_config = _resolve_smtp_runtime_config(smtp_config)

    logger.warning(
        "test_email_send_start to=%s host=%s port=%s encryption=%s username_present=%s",
        to_email,
        runtime_config["host"],
        runtime_config["port"],
        runtime_config["encryption"],
        bool(runtime_config["username"]),
    )

    subject = "ProfitPath Email Configuration Test"
    body = (
        "This is a test email from ProfitPath.\n\n"
        "If you received this email, your SMTP settings are configured correctly.\n\n"
        "Best regards,\n"
        "ProfitPath Team"
    )

    try:
        send_notification_email(
            to_email=to_email,
            subject=subject,
            text_body=body,
            title="Email Configuration Test",
            paragraphs=[
                "This is a test email from ProfitPath.",
                "If you received this email, your SMTP settings are configured correctly.",
                "Best regards,<br>ProfitPath Team",
            ],
            smtp_config=smtp_config,
        )
        logger.warning(
            "test_email_send_success to=%s host=%s port=%s",
            to_email,
            runtime_config["host"],
            runtime_config["port"],
        )
    except smtplib.SMTPAuthenticationError as e:
        logger.exception(
            "test_email_send_auth_failed to=%s host=%s port=%s",
            to_email,
            runtime_config["host"],
            runtime_config["port"],
        )
        raise ValueError(f"SMTP authentication failed: {str(e)}")
    except smtplib.SMTPException as e:
        logger.exception(
            "test_email_send_smtp_error to=%s host=%s port=%s",
            to_email,
            runtime_config["host"],
            runtime_config["port"],
        )
        raise ValueError(f"SMTP error: {str(e)}")
    except Exception as e:
        logger.exception(
            "test_email_send_failed to=%s host=%s port=%s",
            to_email,
            runtime_config["host"],
            runtime_config["port"],
        )
        raise ValueError(f"Failed to send email: {str(e)}")


def send_reset_email(to_email: str, reset_link: str) -> None:
    subject = "Reset your ProfitPath password"
    body = (
        "We received a request to reset your password.\n\n"
        f"Reset link: {reset_link}\n\n"
        f"This link expires in {settings.reset_token_ttl_minutes} minutes.\n"
        "If you did not request this, please ignore this email."
    )
    send_notification_email(
        to_email=to_email,
        subject=subject,
        text_body=body,
        title="Password Reset Request",
        paragraphs=[
            "We received a request to reset your password.",
            f"This link expires in {settings.reset_token_ttl_minutes} minutes.",
            "If you did not request this, please ignore this email.",
        ],
        cta_label="Reset Password",
        cta_url=reset_link,
    )
