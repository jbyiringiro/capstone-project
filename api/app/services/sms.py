"""Text messages to caregivers' phones: the codes that prove a caregiver holds a mobile number.

Africa's Talking sends them once an API key is set. Local development may write messages to the
API's log instead; public deployments disable that fallback.

Each sender says where its texts go (`delivery`): `sms` to the phone, `simulator` to Africa's
Talking's sandbox simulator (never a phone), `log` to this server's log, or `off`. A text the
provider took (status 100 to 102) has reached the provider, not yet the phone: delivery to the
handset shows only in the provider's delivery reports.
"""
from __future__ import annotations

import json
import logging
from typing import Protocol
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .errors import SmsFailed, SmsUnavailable

log = logging.getLogger(__name__)


class SmsSender(Protocol):
    delivery: str

    def send(self, phone: str, text: str) -> None: ...


class LogSms:
    """Writes each message to the log, where the developer reads the code."""

    delivery = "log"

    def send(self, phone: str, text: str) -> None:
        log.warning("SMS to %s: %s", phone, text)


class DisabledSms:
    """Refuses delivery without exposing a caregiver's number or code in server logs."""

    delivery = "off"

    def send(self, phone: str, text: str) -> None:
        raise SmsUnavailable("sms is not set up on this server")


def create_sms_sender(*, username: str, api_key: str | None, log_enabled: bool,
                      sender_id: str | None = None) -> SmsSender:
    # Values pasted into a hosting dashboard often carry a space or a line break, which the
    # provider would refuse as a wrong key or username.
    api_key, sender_id = (api_key or "").strip(), (sender_id or "").strip() or None
    if api_key:
        return AfricasTalkingSms((username or "").strip() or "sandbox", api_key, sender_id)
    return LogSms() if log_enabled else DisabledSms()


# A recipient's status codes for a message Africa's Talking took: processed, sent and queued.
_TAKEN = {100, 101, 102}


class AfricasTalkingSms:
    """Sends through Africa's Talking. The username "sandbox" uses their free sandbox, whose
    messages arrive in the simulator on their website instead of on a real phone."""

    def __init__(self, username: str, api_key: str, sender_id: str | None = None,
                 timeout: float = 10, open_url=urlopen) -> None:
        sandbox = username == "sandbox"
        host = "api.sandbox.africastalking.com" if sandbox else "api.africastalking.com"
        self.url = f"https://{host}/version1/messaging"
        self.delivery = "simulator" if sandbox else "sms"
        self.username, self.api_key, self.sender_id = username, api_key, sender_id
        self.timeout, self.open_url = timeout, open_url

    def send(self, phone: str, text: str) -> None:
        fields = {"username": self.username, "to": phone, "message": text}
        if self.sender_id:
            fields["from"] = self.sender_id
        request = Request(self.url, data=urlencode(fields).encode(), method="POST", headers={
            "apiKey": self.api_key, "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "vuga-api/1.0"})
        try:
            with self.open_url(request, timeout=self.timeout) as response:
                recipients = json.load(response)["SMSMessageData"]["Recipients"]
            statuses = [r.get("statusCode") for r in recipients]
        except HTTPError as error:
            # Provider bodies may echo submitted credentials or message text. Log only the
            # HTTP status, never an untrusted response body or reason. A server error/timeout
            # can occur after acceptance, so its reserved cooldown and budget must remain.
            log.error("Africa's Talking refused the request (HTTP %s)", error.code)
            uncertain = not (400 <= error.code < 500 and error.code != 408)
            raise SmsFailed("could not send the code", delivery_uncertain=uncertain) from error
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            log.error("Africa's Talking did not answer as expected: %s", type(error).__name__)
            raise SmsFailed("could not send the code", delivery_uncertain=True) from error
        # Keep only bounded numeric protocol statuses; even a provider's status label
        # is untrusted text and must never be copied into a production log.
        safe = [code if isinstance(code, int) and not isinstance(code, bool)
                and 100 <= code <= 999 else "unexpected" for code in statuses]
        if not safe or any(code not in _TAKEN for code in safe):
            log.error("Africa's Talking refused the SMS (recipient status codes: %s)", safe)
            # Only an explicit client refusal is definite. Gateway/server errors, partial
            # acceptance and unknown protocol values do not prove that no text was sent.
            uncertain = not safe or any(
                not (isinstance(code, int) and 400 <= code < 500 and code != 408)
                for code in safe)
            raise SmsFailed("could not send the code", delivery_uncertain=uncertain)
