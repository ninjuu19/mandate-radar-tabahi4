import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging

logger = logging.getLogger(__name__)

def send_welcome_email(recipient_email: str, recipient_name: str) -> bool:
    """
    Sends a welcome / registration confirmation email if SMTP is configured.
    Reads SMTP credentials from environment variables:
      - SMTP_HOST (e.g. smtp.gmail.com, smtp.resend.com, smtp.sendgrid.net)
      - SMTP_PORT (e.g. 587)
      - SMTP_USER (e.g. your_email@gmail.com or 'resend' or 'apikey')
      - SMTP_PASSWORD (e.g. Google App Password or SendGrid/Resend API Key)
      - SMTP_FROM (e.g. Mandate Radar <noreply@yourdomain.com>)
    """
    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM", user or "noreply@mandateradar.com")

    if not host or not user or not password:
        logger.info(f"SMTP not configured. Skipping welcome email to {recipient_email}.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Welcome to Mandate Radar - Account Registered"
        msg["From"] = f"Mandate Radar <{sender}>" if "<" not in sender else sender
        msg["To"] = recipient_email

        html_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; background-color: #0d121e; color: #ffffff; padding: 24px;">
            <div style="max-width: 520px; margin: 0 auto; background-color: #111726; border: 1px solid #23304a; border-radius: 12px; padding: 28px;">
                <h2 style="color: #38bdf8; margin-top: 0; font-size: 20px;">Welcome to Mandate Radar!</h2>
                <p style="color: #e2e8f0; font-size: 14px; line-height: 1.6;">Hi {recipient_name},</p>
                <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6;">
                    Your account (<code>{recipient_email}</code>) has been successfully created.
                </p>
                <div style="margin: 20px 0; padding: 14px; background-color: #080b12; border-left: 4px solid #22d3ee; border-radius: 4px;">
                    <p style="margin: 0; font-size: 13px; color: #94a3b8;">
                        • <strong>Automated Recurrence Detection</strong>: Ingest bank statements and detect hidden auto-debits.<br/>
                        • <strong>Neo4j Bundle Traversal</strong>: Catch overlapping subscriptions and redundant services.<br/>
                        • <strong>RBI Statutory Notices</strong>: Exercise legal cancellation rights for UPI AutoPay, e-mandates & NACH.
                    </p>
                </div>
                <hr style="border: none; border-top: 1px solid #23304a; margin: 24px 0;" />
                <p style="font-size: 12px; color: #64748b; margin: 0;">
                    Mandate Radar | Neo4j Knowledge Graph & Deterministic Ingestion Engine
                </p>
            </div>
        </body>
        </html>
        """
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(host, port, timeout=10) as server:
            server.starttls()
            server.login(user, password)
            server.sendmail(sender, recipient_email, msg.as_string())
        logger.info(f"Welcome email successfully sent to {recipient_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {recipient_email}: {e}")
        return False
