import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Конфиденциальность · QorgauAI" };

const CONTACT = "aldiar12378@gmail.com";

// Linked from the Google OAuth consent screen and the sign-in page.
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/" className="t-caption font-medium text-accent-ink">
        ← QorgauAI
      </Link>
      <h1 className="t-display mt-3">Политика конфиденциальности</h1>
      <p className="t-caption mt-2 text-text-3">Действует с 25 сентября 2026 года</p>

      <div className="t-body mt-8 space-y-6 text-text-2 [&_strong]:text-text">
        <p>
          QorgauAI — учебный проект: информационный помощник по Конституции и Трудовому кодексу Республики Казахстан.
          Ответы сервиса — справочная информация, а не юридическая консультация.
        </p>

        <section className="space-y-2">
          <h2 className="t-title text-text">Какие данные мы получаем</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Из аккаунта Google</strong> при входе: имя, адрес электронной почты и аватар. Доступа к почте,
              файлам или контактам у сервиса нет.
            </li>
            <li>
              <strong>Ваши вопросы и загруженные договоры</strong> — чтобы подготовить ответ.
            </li>
            <li>
              <strong>Оценки ответов</strong> (👍/👎) и необязательный комментарий к ним.
            </li>
            <li>
              <strong>Служебные данные:</strong> число вопросов в день и стоимость ответа — для дневного лимита.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="t-title text-text">Как мы защищаем персональные данные</h2>
          <p>
            ИИН, номера телефонов, e-mail и банковские реквизиты в тексте вопроса или договора автоматически скрываются{" "}
            <strong>до отправки в языковую модель</strong>. В журнале вопросов и в трейсах мониторинга они тоже хранятся
            в скрытом виде.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="t-title text-text">Кто обрабатывает данные</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>OpenAI — формирует ответ по тексту вопроса со скрытыми персональными данными.</li>
            <li>Langfuse — мониторинг качества ответов, получает те же скрытые данные.</li>
            <li>Railway — хостинг сервиса и базы данных.</li>
            <li>Google — только вход в аккаунт.</li>
          </ul>
          <p>Данные не продаются и не передаются для рекламы.</p>
        </section>

        <section className="space-y-2">
          <h2 className="t-title text-text">Сколько хранятся данные и как их удалить</h2>
          <p>
            Текущая переписка хранится, чтобы вы видели её на любом устройстве. Кнопка «Новый чат» удаляет её с сервера.
            Чтобы удалить аккаунт и все связанные данные, напишите на{" "}
            <a href={`mailto:${CONTACT}`} className="font-medium text-accent-ink">
              {CONTACT}
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="t-title text-text">Контакты</h2>
          <p>
            Вопросы о данных:{" "}
            <a href={`mailto:${CONTACT}`} className="font-medium text-accent-ink">
              {CONTACT}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
