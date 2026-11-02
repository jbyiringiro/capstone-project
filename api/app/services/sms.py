"""Text messages to caregivers' phones: the codes that prove a caregiver holds a mobile number.

Africa's Talking sends them once an API key is set. Without one, each message is written to the
API's log instead, which is enough on a developer machine.
"""
from __future__ import annotations

import json
import logging
from typing import Protocol
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .errors import SmsFailed

log = logging.getLogger(__name__)


class SmsSender(Protocol):
    def send(self, phone: str, text: str) -> None: ...


class LogSms:
    """Writes each message to the log, where the developer reads the code."""

    def send(self, phone: str, text: str) -> None:
        log.warning("SMS to %s: %s", phone, text)


# A recipient's status codes for a message Africa's Talking took: processed, sent and queued.
_TAKEN = {100, 101, 102}


class AfricasTalkingSms:
    """Sends through Africa's Talking. The username "sandbox" uses their free sandbox, whose
    messages arrive in the simulator on their website instead of on a real phone."""

    def __init__(self, username: str, api_key: str, sender_id: str | None = None,
                 timeout: float = 10, open_url=urlopen) -> None:
        host = "api.sandbox.africastalking.com" if username == "sandbox" else "api.africastalking.com"
        self.url = f"https://{host}/version1/messaging"
        self.username, self.api_key, self.sender_id = username, api_key, sender_id
        self.timeout, self.open_url = timeout, open_url

    def send(self, phone: str, text: str) -> None:
        fields = {"username": self.username, "to": phone, "message": text}
        if self.sender_id:
            fields["from"] = self.sender_id
        request = Request(self.url, data=urlencode(fields).encode(), method="POST", headers={
            "apiKey": self.api_key, "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded"})
        try:
            with self.open_url(request, timeout=self.timeout) as response:
                recipients = json.load(response)["SMSMessageData"]["Recipients"]
            statuses = [(r.get("statusCode"), r.get("status")) for r in recipients]
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            # A wrong key or username comes back as an HTTP error, which is an OSError.
            log.error("Africa's Talking did not send the SMS: %s", error)
            raise SmsFailed("could not send the code") from error
        if not statuses or any(code not in _TAKEN for code, _ in statuses):
            log.error("Africa's Talking refused the SMS: %s", statuses)
            raise SmsFailed("could not send the code")
