"""The language of the answer: Russian, Kazakh or English.

The corpus, the search and the prompts stay Russian. For another language the
generator and the reviewer get one extra instruction in the user message, so
the Russian path sends exactly the same prompts as before. Citations, quotes
from the law and suggested contract wording stay in Russian: that is the text
of the law and of the contract itself."""

from __future__ import annotations

from typing import Literal

Lang = Literal["ru", "kk", "en"]
LANGS: tuple[Lang, ...] = ("ru", "kk", "en")

_NAME = {"kk": "казахском", "en": "английском"}


def research_note(lang: Lang) -> str:
    """For the planner: the corpus is Russian, so every search query must be too."""
    if lang == "ru":
        return ""
    return (
        f"\n\nВопрос задан на {_NAME[lang]} языке, а корпус — на русском. Переведи суть вопроса на русский "
        "и формулируй все запросы к `search_legal_corpus` только по-русски, юридическими словами из текста закона."
    )


def answer_note(lang: Lang) -> str:
    """For the generator: which fields to write in the user's language."""
    if lang == "ru":
        return ""
    return (
        f"\n\nЯзык ответа: пиши `claims`, `missing_info` и `follow_up_questions` на {_NAME[lang]} языке. "
        "Ищи и опирайся на русские фрагменты как обычно; числа, сроки и номера статей переноси точно."
    )


def verify_note(lang: Lang) -> str:
    """For a verifier: claims in another language are checked by meaning."""
    if lang == "ru":
        return ""
    return (
        f"\n\nУтверждения написаны на {_NAME[lang]} языке, фрагменты — на русском. Сравнивай смысл, "
        "числа и условия; язык сам по себе не причина для `supported=false`. "
        f"`explanation` пиши на {_NAME[lang]} языке."
    )


def review_note(lang: Lang) -> str:
    """For the contract reviewer: explanations for the user, the fix stays Russian."""
    if lang == "ru":
        return ""
    return (
        f"\n\nЯзык: `explanation` пиши на {_NAME[lang]} языке для работника. "
        "`fix` оставь на русском: это готовый текст пункта договора, который составлен на русском."
    )


TEXT: dict[str, dict[Lang, str]] = {
    "disclaimer": {
        "ru": "QorgauAI — информационный помощник, а не юрист. Ответ основан только на процитированных нормах "
        "Конституции и Трудового кодекса РК; для спорной ситуации обратитесь к практикующему юристу.",
        "kk": "QorgauAI — ақпараттық көмекші, заңгер емес. Жауап тек ҚР Конституциясы мен Еңбек кодексінің "
        "келтірілген нормаларына негізделген; даулы жағдайда тәжірибелі заңгерге жүгініңіз.",
        "en": "QorgauAI is an information assistant, not a lawyer. The answer relies only on the cited provisions "
        "of the Constitution and the Labor Code of Kazakhstan; for a dispute, consult a practising lawyer.",
    },
    "out_of_scope": {
        "ru": "Этот вопрос вне тем, которые покрывает QorgauAI: сейчас в базе только Конституция и Трудовой кодекс "
        "Республики Казахстан.",
        "kk": "Бұл сұрақ QorgauAI қамтитын тақырыптардан тыс: қазір базада тек Қазақстан Республикасының "
        "Конституциясы мен Еңбек кодексі бар.",
        "en": "This question is outside what QorgauAI covers: the database holds only the Constitution and the "
        "Labor Code of the Republic of Kazakhstan.",
    },
    "no_norm": {
        "ru": "В доступных текстах Конституции и Трудового кодекса РК не нашлось нормы, которая отвечает на этот вопрос.",
        "kk": "ҚР Конституциясы мен Еңбек кодексінің қолжетімді мәтіндерінде бұл сұраққа жауап беретін норма табылмады.",
        "en": "No provision answering this question was found in the Constitution or the Labor Code of Kazakhstan.",
    },
    "unconfirmed": {
        "ru": "Не удалось подтвердить ответ нормами Конституции и Трудового кодекса РК, поэтому я не буду его давать.",
        "kk": "Жауапты ҚР Конституциясы мен Еңбек кодексінің нормаларымен растау мүмкін болмады, сондықтан оны бермеймін.",
        "en": "I could not confirm an answer with provisions of the Constitution and the Labor Code of Kazakhstan, "
        "so I will not give one.",
    },
    "review_disclaimer": {
        "ru": "Проверка сравнивает пункты только с Конституцией и Трудовым кодексом РК. «Нарушений не найдено» не "
        "значит, что пункт безупречен: другие законы и обстоятельства дела не учитываются. Для спора обратитесь к юристу.",
        "kk": "Тексеру тармақтарды тек ҚР Конституциясы мен Еңбек кодексімен салыстырады. «Бұзушылық табылмады» "
        "тармақ мінсіз дегенді білдірмейді: басқа заңдар мен істің мән-жайы ескерілмейді. Дау болса, заңгерге жүгініңіз.",
        "en": "The review compares clauses only with the Constitution and the Labor Code of Kazakhstan. \"No violation "
        "found\" does not mean the clause is flawless: other laws and the facts of the case are not considered. "
        "For a dispute, consult a lawyer.",
    },
    "no_verdict": {
        "ru": "Модель не вынесла вердикт по этому пункту — проверьте его сами.",
        "kk": "Модель бұл тармақ бойынша шешім шығармады — оны өзіңіз тексеріңіз.",
        "en": "The model gave no verdict on this clause; please check it yourself.",
    },
    "not_confirmed": {
        "ru": "Проверяющий не подтвердил нарушение:",
        "kk": "Тексеруші бұзушылықты растамады:",
        "en": "The verifier did not confirm the violation:",
    },
    "no_norm_reason": {
        "ru": "вывод не подкреплён найденной нормой.",
        "kk": "қорытынды табылған нормамен расталмаған.",
        "en": "the conclusion is not backed by a norm that was found.",
    },
}


def text(key: str, lang: Lang) -> str:
    return TEXT[key][lang]
