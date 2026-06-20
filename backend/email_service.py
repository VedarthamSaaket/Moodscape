import time
import smtplib
import requests
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText

from config import (
    GMAIL_USER, GMAIL_APP_PASSWORD,
    RESEND_API_KEY, RESEND_FROM,
    logger,
)


def _send_via_resend(to: str, subject: str, html: str) -> bool:
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type":  "application/json",
            },
            json={"from": RESEND_FROM, "to": [to], "subject": subject, "html": html},
            timeout=15,
        )
        if 200 <= r.status_code < 300:
            logger.info(f"[EMAIL] ✓ sent to {to} via Resend")
            return True
        logger.error(f"[EMAIL] ✗ Resend {r.status_code}: {r.text[:200]}")
        return False
    except Exception as exc:
        logger.error(f"[EMAIL] ✗ Resend transport error: {exc}")
        return False


def _send_via_smtp(to: str, subject: str, html: str) -> bool:
    pwd = (GMAIL_APP_PASSWORD or "").replace(" ", "")
    for attempt in range(2):
        try:
            msg            = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"]    = f"MoodScape <{GMAIL_USER}>"
            msg["To"]      = to
            msg.attach(MIMEText(html, "html"))
            with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(GMAIL_USER, pwd)
                server.sendmail(GMAIL_USER, to, msg.as_string())
            logger.info(f"[EMAIL] ✓ sent to {to} via SMTP")
            return True
        except smtplib.SMTPAuthenticationError:
            logger.error("[EMAIL] ✗ SMTP auth failed — check GMAIL_USER and GMAIL_APP_PASSWORD")
            return False
        except Exception as exc:
            if attempt == 0:
                logger.warning(f"[EMAIL] SMTP attempt 1 failed ({exc}), retrying in 2s…")
                time.sleep(2)
            else:
                logger.error(f"[EMAIL] ✗ SMTP: {exc}")
    return False


def send_email(to: str, subject: str, html: str) -> bool:
    """Send transactional email. Prefers Resend (HTTPS, works on hosts that
    block outbound SMTP like Render free tier). Falls back to Gmail SMTP when
    RESEND_API_KEY isn't configured."""
    if RESEND_API_KEY:
        return _send_via_resend(to, subject, html)
    return _send_via_smtp(to, subject, html)


def verification_html(code: str) -> str:
    digits = "".join(
        f'<span style="display:inline-block;width:44px;height:56px;line-height:56px;'
        f'text-align:center;margin:0 4px;border-radius:10px;'
        f'background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.25);'
        f'font-size:28px;font-weight:700;color:#c4b5fd;">'
        f'{ch}</span>'
        for ch in code
    )
    year = __import__('datetime').datetime.utcnow().year
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07080d;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#07080d;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="480"
             style="background:#0d0e17;border-radius:20px;border:1px solid rgba(167,139,250,0.14);">
        <tr><td style="padding:44px 44px 0;">
          <div style="font-size:26px;font-weight:700;letter-spacing:0.06em;color:#c4b5fd;">MoodScape</div>
          <div style="height:1px;margin:22px 0;background:linear-gradient(to right,transparent,rgba(167,139,250,0.2),transparent);"></div>
          <p style="margin:0 0 8px;font-size:19px;font-weight:600;color:#dde8ff;">Verify your email</p>
          <p style="margin:0 0 30px;font-size:14px;color:rgba(175,198,255,0.55);line-height:1.7;">
            Enter this 6-digit code in MoodScape to confirm your account.
          </p>
          <div style="text-align:center;margin-bottom:28px;">{digits}</div>
          <div style="text-align:center;margin-bottom:36px;">
            <span style="display:inline-block;padding:8px 18px;border-radius:30px;
                         background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
                         font-size:12px;color:rgba(175,198,255,0.45);">⏱ Expires in 15 minutes</span>
          </div>
        </td></tr>
        <tr><td style="padding:0 44px 32px;">
          <div style="height:1px;margin-bottom:20px;background:linear-gradient(to right,transparent,rgba(167,139,250,0.1),transparent);"></div>
          <p style="margin:0;font-size:11.5px;color:rgba(150,170,220,0.3);text-align:center;line-height:1.7;">
            If you didn't create a MoodScape account, ignore this email.<br>© {year} MoodScape
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def reset_code_html(code: str) -> str:
    digits = "".join(
        f'<span style="display:inline-block;width:44px;height:56px;line-height:56px;'
        f'text-align:center;margin:0 4px;border-radius:10px;'
        f'background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.25);'
        f'font-size:28px;font-weight:700;color:#c4b5fd;">'
        f'{ch}</span>'
        for ch in code
    )
    year = __import__('datetime').datetime.utcnow().year
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07080d;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#07080d;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="480"
             style="background:#0d0e17;border-radius:20px;border:1px solid rgba(167,139,250,0.14);">
        <tr><td style="padding:44px 44px 0;">
          <div style="font-size:26px;font-weight:700;letter-spacing:0.06em;color:#c4b5fd;">MoodScape</div>
          <div style="height:1px;margin:22px 0;background:linear-gradient(to right,transparent,rgba(167,139,250,0.2),transparent);"></div>
          <p style="margin:0 0 8px;font-size:19px;font-weight:600;color:#dde8ff;">Reset your password</p>
          <p style="margin:0 0 30px;font-size:14px;color:rgba(175,198,255,0.55);line-height:1.7;">
            Enter this 6-digit code in MoodScape to reset your password.
          </p>
          <div style="text-align:center;margin-bottom:28px;">{digits}</div>
          <div style="text-align:center;margin-bottom:36px;">
            <span style="display:inline-block;padding:8px 18px;border-radius:30px;
                         background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
                         font-size:12px;color:rgba(175,198,255,0.45);">⏱ Expires in 15 minutes</span>
          </div>
        </td></tr>
        <tr><td style="padding:0 44px 32px;">
          <div style="height:1px;margin-bottom:20px;background:linear-gradient(to right,transparent,rgba(167,139,250,0.1),transparent);"></div>
          <p style="margin:0;font-size:11.5px;color:rgba(150,170,220,0.3);text-align:center;line-height:1.7;">
            If you didn't request a password reset, ignore this email, your password stays the same.<br>© {year} MoodScape
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def reset_link_html(link: str) -> str:
    year = __import__('datetime').datetime.utcnow().year
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07080d;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#07080d;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="480"
             style="background:#0d0e17;border-radius:20px;border:1px solid rgba(167,139,250,0.14);">
        <tr><td style="padding:44px 44px 0;">
          <div style="font-size:26px;font-weight:700;letter-spacing:0.06em;color:#c4b5fd;">MoodScape</div>
          <div style="height:1px;margin:22px 0;background:linear-gradient(to right,transparent,rgba(167,139,250,0.2),transparent);"></div>
          <p style="margin:0 0 8px;font-size:19px;font-weight:600;color:#dde8ff;">Reset your password</p>
          <p style="margin:0 0 30px;font-size:14px;color:rgba(175,198,255,0.55);line-height:1.7;">
            Click the button below to choose a new password. This link expires in 30 minutes.
          </p>
          <div style="text-align:center;margin-bottom:30px;">
            <a href="{link}" style="display:inline-block;padding:14px 32px;border-radius:12px;
               background:linear-gradient(110deg,#a78bfa,#7c5cff);color:#0d0e17;font-size:15px;
               font-weight:700;text-decoration:none;">Reset password</a>
          </div>
          <p style="margin:0 0 36px;font-size:12px;color:rgba(175,198,255,0.4);line-height:1.7;word-break:break-all;">
            Or paste this link into your browser:<br>
            <a href="{link}" style="color:#c4b5fd;">{link}</a>
          </p>
        </td></tr>
        <tr><td style="padding:0 44px 32px;">
          <div style="height:1px;margin-bottom:20px;background:linear-gradient(to right,transparent,rgba(167,139,250,0.1),transparent);"></div>
          <p style="margin:0;font-size:11.5px;color:rgba(150,170,220,0.3);text-align:center;line-height:1.7;">
            If you didn't request a password reset, ignore this email, your password stays the same.<br>© {year} MoodScape
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""