import pytest

from app.mcp_tools.vacation_calculator import calculate_annual_leave


def test_base_only():
    r = calculate_annual_leave()
    assert r.base_days == 24
    assert r.additional_days == 0
    assert r.total_days == 24
    assert r.citations == ["Трудовой кодекс РК, Статья 88"]
    assert r.note is None


def test_hazardous_adds_minimum_six_days():
    r = calculate_annual_leave(hazardous_work=True)
    assert r.total_days == 30
    assert r.note is not None  # caveat about the government-approved list


def test_disability_adds_minimum_six_days():
    r = calculate_annual_leave(disability_group_1_or_2=True)
    assert r.total_days == 30


def test_hazardous_and_disability_stack():
    r = calculate_annual_leave(hazardous_work=True, disability_group_1_or_2=True)
    assert r.total_days == 36


def test_employer_bonus_days_included_when_provided():
    r = calculate_annual_leave(employer_bonus_days=5)
    assert r.total_days == 29
    assert any("Статья 89, пункт 3" in c for c in r.citations)


def test_negative_bonus_days_rejected():
    with pytest.raises(ValueError):
        calculate_annual_leave(employer_bonus_days=-1)


def test_every_component_has_a_citation():
    r = calculate_annual_leave(hazardous_work=True, disability_group_1_or_2=True, employer_bonus_days=2)
    assert len(r.citations) == len(r.breakdown) == 4
