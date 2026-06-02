import time
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText

from config import GMAIL_USER, GMAIL_APP_PASSWORD, logger


def send_email(to: str, subject: str, html: str) -> bool:
    pwd = (GMAIL_APP_PASSWORD or "").replace(" ", "")
    for attempt in range(2):
        try:
            msg            = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"]    = f"MoodScape <{GMAIL_USER}>"
            msg["To"]      = to
            msg.attach(MIMEText(html, "html"))
            with smtplib.SMTP("smtp.gmail.com", 587) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(GMAIL_USER, pwd)
                server.sendmail(GMAIL_USER, to, msg.as_string())
            logger.info(f"[EMAIL] ✓ sent to {to}")
            return True
        except smtplib.SMTPAuthenticationError:
            logger.error("[EMAIL] ✗ Auth failed — check GMAIL_USER and GMAIL_APP_PASSWORD in .env")
            return False
        except Exception as exc:
            if attempt == 0:
                logger.warning(f"[EMAIL] attempt 1 failed ({exc}), retrying in 2s…")
                time.sleep(2)
            else:
                logger.error(f"[EMAIL] ✗ {exc}")
    return False


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