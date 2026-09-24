from app.guardrails.pii import contains_pii, mask_pii, redact


def test_masks_kz_formats():
    text = (
        "Работник Иванов, ИИН 900101300123, тел. +7 (701) 123-45-67, "
        "счёт KZ12345678901234567890 (опечатка не важна), e-mail ivanov@mail.kz"
    )
    masked, mapping = mask_pii(text)
    assert "900101300123" not in masked
    assert "123-45-67" not in masked
    assert "ivanov@mail.kz" not in masked
    assert "[IIN_1]" in masked and "[PHONE_1]" in masked and "[EMAIL_1]" in masked
    assert mapping["[IIN_1]"] == "900101300123"


def test_masks_iban_before_digit_patterns():
    masked, mapping = mask_pii("IBAN: KZ86125KZT5004100100")
    assert masked == "IBAN: [IBAN_1]"
    assert mapping["[IBAN_1]"] == "KZ86125KZT5004100100"


def test_masks_api_keys():
    assert "sk-proj-" not in redact("ключ sk-proj-abcdefghijklmnopqrstuv в логе")
    assert "[SECRET_1]" in redact("pk-lf-0123456789abcdef0123")


def test_leaves_legal_text_alone():
    norm = (
        "Основной оплачиваемый ежегодный трудовой отпуск предоставляется продолжительностью "
        "двадцать четыре календарных дня (Статья 88), Закон РК от 04.07.2023 № 15-VIII."
    )
    assert redact(norm) == norm
    assert not contains_pii(norm)
