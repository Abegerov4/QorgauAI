"""
Vacation-day calculator, grounded in the parsed corpus (doc section 4/12/13:
"один MCP-инструмент... например, калькулятор дней отпуска").

Legal basis (backend/data/processed/labor_code_chunks.jsonl):
  - Статья 88: base annual paid leave = 24 calendar days minimum.
  - Статья 89, п.1, пп.1): +6 calendar days minimum for hazardous/heavy work.
  - Статья 89, п.1, пп.2): +6 calendar days minimum for disability group I/II.
  - Статья 89, п.3: employer/collective-agreement bonus days are discretionary,
    not a statutory entitlement -- only included if the caller supplies them.

Deliberately does NOT invent a tenure-based bonus: the Labor Code ties the
base entitlement to the 24-day minimum regardless of years worked, and the
golden-dataset question in doc section 9 ("...если я работаю 3 года?") is
designed to test that the assistant doesn't hallucinate one.
"""

from __future__ import annotations

from dataclasses import dataclass, field

BASE_DAYS = 24
HAZARDOUS_MIN_ADDITIONAL_DAYS = 6
DISABILITY_MIN_ADDITIONAL_DAYS = 6

BASE_CITATION = "Трудовой кодекс РК, Статья 88"
HAZARDOUS_CITATION = "Трудовой кодекс РК, Статья 89, пункт 1, подпункт 1)"
DISABILITY_CITATION = "Трудовой кодекс РК, Статья 89, пункт 1, подпункт 2)"
BONUS_CITATION = "Трудовой кодекс РК, Статья 89, пункт 3 (по трудовому/коллективному договору, не гарантировано законом)"


@dataclass
class VacationResult:
    base_days: int
    additional_days: int
    total_days: int
    breakdown: list[str] = field(default_factory=list)
    citations: list[str] = field(default_factory=list)
    note: str | None = None


def calculate_annual_leave(
    hazardous_work: bool = False,
    disability_group_1_or_2: bool = False,
    employer_bonus_days: int = 0,
) -> VacationResult:
    """Calculate statutory minimum annual paid leave (calendar days).

    Args:
        hazardous_work: employee is in heavy/hazardous working conditions
            (Статья 89, п.1, пп.1) -- the exact figure depends on a
            government-approved list of professions the calculator doesn't
            have access to, so the legal minimum (6 days) is used.
        disability_group_1_or_2: employee has disability group I or II
            (Статья 89, п.1, пп.2).
        employer_bonus_days: additional days granted by the specific
            employer's labor/collective agreement, if known (Статья 89,
            п.3) -- not a statutory guarantee, so defaults to 0.

    Returns:
        VacationResult with a breakdown and citations for every component,
        so the Verifier agent (doc section 8) can check each claim against
        its source rather than trusting the arithmetic blindly.
    """
    if employer_bonus_days < 0:
        raise ValueError("employer_bonus_days cannot be negative")

    breakdown = [f"База (Статья 88): {BASE_DAYS} календарных дня"]
    citations = [BASE_CITATION]
    additional = 0

    if hazardous_work:
        additional += HAZARDOUS_MIN_ADDITIONAL_DAYS
        breakdown.append(
            f"За вредные/тяжёлые условия труда (Статья 89, п.1, пп.1): "
            f"+{HAZARDOUS_MIN_ADDITIONAL_DAYS} дней (законодательный минимум)"
        )
        citations.append(HAZARDOUS_CITATION)

    if disability_group_1_or_2:
        additional += DISABILITY_MIN_ADDITIONAL_DAYS
        breakdown.append(
            f"За инвалидность I/II группы (Статья 89, п.1, пп.2): "
            f"+{DISABILITY_MIN_ADDITIONAL_DAYS} дней (законодательный минимум)"
        )
        citations.append(DISABILITY_CITATION)

    if employer_bonus_days:
        additional += employer_bonus_days
        breakdown.append(
            f"Поощрительный отпуск по договору (Статья 89, п.3): +{employer_bonus_days} дней"
        )
        citations.append(BONUS_CITATION)

    note = None
    if hazardous_work:
        note = (
            "Точная продолжительность доп. отпуска за вредность зависит от утверждённого "
            "Правительством РК перечня производств/профессий и может быть больше "
            "законодательного минимума в 6 дней -- для точной цифры нужно свериться с этим "
            "перечнем для конкретной должности."
        )

    return VacationResult(
        base_days=BASE_DAYS,
        additional_days=additional,
        total_days=BASE_DAYS + additional,
        breakdown=breakdown,
        citations=citations,
        note=note,
    )
