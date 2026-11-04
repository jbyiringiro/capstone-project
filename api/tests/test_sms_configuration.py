"""SMS delivery must fail clearly when a public host has no provider credentials."""
import pytest

from app.config import Settings
from app.services.errors import SmsFailed
from app.services.sms import AfricasTalkingSms, DisabledSms, LogSms, create_sms_sender


def test_local_development_can_use_logged_codes(monkeypatch):
    monkeypatch.delenv("VUGA_SMS_LOG_ENABLED", raising=False)
    settings = Settings(_env_file=None)
    sender = create_sms_sender(username="sandbox", api_key=None,
                               log_enabled=settings.sms_log_enabled)
    assert isinstance(sender, LogSms)


def test_public_host_without_credentials_refuses_codes_without_logging(monkeypatch, caplog):
    monkeypatch.setenv("VUGA_SMS_LOG_ENABLED", "false")
    settings = Settings(_env_file=None)
    sender = create_sms_sender(username="sandbox", api_key=None,
                               log_enabled=settings.sms_log_enabled)
    assert isinstance(sender, DisabledSms)
    with pytest.raises(SmsFailed, match="could not send the code"):
        sender.send("+250780000001", "Your code is 123456")
    assert not caplog.records


@pytest.mark.parametrize("log_enabled", [False, True])
def test_provider_credentials_take_precedence_over_log_fallback(log_enabled):
    sender = create_sms_sender(username="vuga-test", api_key="test-key",
                               sender_id="Vuga", log_enabled=log_enabled)
    assert isinstance(sender, AfricasTalkingSms)
    assert sender.username == "vuga-test"
    assert sender.api_key == "test-key"
    assert sender.sender_id == "Vuga"
    assert sender.url == "https://api.africastalking.com/version1/messaging"
