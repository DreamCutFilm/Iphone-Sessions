// Акаунт, фірма й команда.
//
// Дані тут приходять із мережі, а не зі сховища, тому екран будується інакше
// за решту застосунку: спершу малюємо каркас, потім наповнюємо. Кожен блок
// сам показує, що він завантажується або що звʼязку немає.

import { el, toast } from '../dom.js';
import { pageHeader, sectionTitle, chip } from '../components.js';
import {
  openSheet, closeSheet, confirmSheet, field, formBody,
  textInput, textArea, selectInput, segmented,
} from '../sheet.js';
import { navigate } from '../router.js';
import {
  isSignedIn, currentUser, signIn, signUp, signOut, resetPassword, CloudError,
} from '../../core/cloud.js';
import {
  myCompanies, createCompany, updateCompany, searchCompanies, requestJoin, myRequests,
  teamOf, pendingRequests, approveRequest, declineRequest, changeRole, removeMember,
  createInvite, activeInvites, revokeInvite, redeemInvite,
  makeSlug, isValidSlug, roleLabel, canManage, ROLES,
} from '../../core/account.js';

/** Обгортка навколо мережевої дії: показує помилку людською мовою. */
async function run(action, { onError } = {}) {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof CloudError ? error.message : 'Немає звʼязку з сервером';
    if (onError) onError(message);
    else toast(message, { error: true });
    return null;
  }
}

function spinner(text = 'Завантажую…') {
  return el('p.settings-note', text);
}

export function accountView() {
  const page = el('div.page');

  page.append(pageHeader('Акаунт', { back: '/settings' }));

  if (!isSignedIn()) {
    page.append(signedOutBlock());
    return page;
  }

  const user = currentUser();
  page.append(el('div.about',
    el('p.about-name', user?.email ?? 'Ти в системі'),
    el('p.about-line', 'Вхід виконано')));

  const companiesHost = el('div');
  page.append(companiesHost);
  loadCompanies(companiesHost);

  page.append(sectionTitle('Акаунт'));
  page.append(el('div.form',
    el('button.btn.btn--ghost.btn--wide', {
      type: 'button',
      onclick: () => confirmSheet({
        title: 'Вийти з акаунта?',
        message: 'Проєкти й кошториси на цьому телефоні залишаться — вони зберігаються локально.',
        confirmLabel: 'Вийти',
        onConfirm: async () => {
          await signOut();
          toast('Ти вийшов');
          navigate('/account');
        },
      }),
    }, 'Вийти')));

  return page;
}

// --- Не ввійшов ------------------------------------------------------------

function signedOutBlock() {
  return el(
    'div.form',
    el('p.settings-note',
      'Акаунт потрібен, щоб працювати командою: спільні проєкти, кошториси й гонорари. ' +
      'Без нього застосунок працює як і працював — усе лишається на цьому телефоні.'),
    el('button.btn.btn--primary.btn--wide', { type: 'button', onclick: () => authSheet('signup') }, 'Створити акаунт'),
    el('button.btn.btn--ghost.btn--wide', { type: 'button', onclick: () => authSheet('signin') }, 'Уже маю акаунт'),
  );
}

function authSheet(mode) {
  const draft = { email: '', password: '', fullName: '', kind: 'company' };
  const isSignup = mode === 'signup';
  const error = el('p.settings-note');

  const rows = [
    isSignup && field('Хто ти', segmented(
      [{ value: 'company', label: 'Фірма' }, { value: 'client', label: 'Клієнт' }],
      draft.kind,
      (value) => { draft.kind = value; },
    ), 'Фірма веде проєкти й команду. Клієнт шукає, кому замовити зйомку.'),
    isSignup && field('Імʼя', textInput({
      placeholder: 'Як тебе звати',
      oninput: (event) => { draft.fullName = event.target.value; },
    })),
    field('Пошта', textInput({
      type: 'email', inputmode: 'email', autocapitalize: 'none', autocomplete: 'email',
      placeholder: 'you@example.com',
      oninput: (event) => { draft.email = event.target.value; },
    })),
    field('Пароль', el('input.input', {
      type: 'password',
      autocomplete: isSignup ? 'new-password' : 'current-password',
      placeholder: isSignup ? 'щонайменше 6 символів' : '',
      oninput: (event) => { draft.password = event.target.value; },
    })),
    error,
    !isSignup && el('button.btn.btn--ghost.btn--wide', {
      type: 'button',
      onclick: async () => {
        if (!draft.email.trim()) { toast('Спершу впиши пошту', { error: true }); return; }
        await run(() => resetPassword(draft.email));
        toast('Лист для зміни пароля надіслано');
      },
    }, 'Забув пароль'),
  ].filter(Boolean);

  openSheet({
    title: isSignup ? 'Створити акаунт' : 'Вхід',
    body: formBody(...rows),
    actions: [
      el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: async (event) => {
          const button = event.currentTarget;
          if (!draft.email.trim() || !draft.password) {
            error.textContent = 'Заповни пошту й пароль';
            return;
          }
          button.disabled = true;
          button.textContent = 'Хвилинку…';
          error.textContent = '';

          const result = await run(
            () => (isSignup ? signUp(draft) : signIn(draft)),
            { onError: (message) => { error.textContent = message; } },
          );

          button.disabled = false;
          button.textContent = isSignup ? 'Створити' : 'Увійти';

          if (result === null) return;

          closeSheet();
          if (isSignup && result.needsConfirmation) {
            toast('Перевір пошту — там лист із підтвердженням');
          } else {
            toast('Готово');
          }
          navigate('/account');
        },
      }, isSignup ? 'Створити' : 'Увійти'),
    ],
  });
}

// --- Фірми -----------------------------------------------------------------

async function loadCompanies(host) {
  host.replaceChildren(sectionTitle('Фірма'), spinner());

  const companies = await run(() => myCompanies());
  if (companies === null) {
    host.replaceChildren(
      sectionTitle('Фірма'),
      el('p.settings-note', 'Не вдалося звʼязатися з сервером. Спробуй пізніше.'),
      el('button.btn.btn--ghost.btn--wide', { type: 'button', onclick: () => loadCompanies(host) }, 'Спробувати ще раз'),
    );
    return;
  }

  if (!companies.length) {
    const requests = (await run(() => myRequests())) ?? [];
    const waiting = requests.filter((request) => request.status === 'pending');

    host.replaceChildren(
      sectionTitle('Фірма'),
      waiting.length
        ? el('div.list', waiting.map((request) => el(
            'article.row',
            el('span.row-mark', '⏳'),
            el('div.row-body',
              el('p.row-title', request.companies?.name ?? 'Фірма'),
              el('p.row-note', 'Заявку надіслано — чекаємо на схвалення')),
          )))
        : el('p.settings-note', 'Ти ще не в жодній фірмі. Створи свою або приєднайся до наявної.'),
      el('div.form',
        el('button.btn.btn--primary.btn--wide', { type: 'button', onclick: () => createCompanySheet(host) }, 'Створити фірму'),
        el('button.btn.btn--ghost.btn--wide', { type: 'button', onclick: () => findCompanySheet(host) }, 'Знайти фірму'),
        el('button.btn.btn--ghost.btn--wide', { type: 'button', onclick: () => inviteCodeSheet(host) }, 'У мене є код запрошення')),
    );
    return;
  }

  host.replaceChildren();
  for (const company of companies) {
    host.append(companyBlock(company, host));
  }
}

function companyBlock(company, host) {
  const block = el('div');

  block.append(sectionTitle(company.name, el('span.section-hint', roleLabel(company.role))));
  block.append(el('div.facts',
    chip(`@${company.slug}`, 'project'),
    company.city ? chip(`📍 ${company.city}`) : null,
    company.listed ? chip('у каталозі', 'money') : chip('прихована')));

  if (canManage(company.role)) {
    block.append(el('div.form',
      el('button.btn.btn--ghost.btn--wide', {
        type: 'button',
        onclick: async () => {
          const next = !company.listed;
          const saved = await run(() => updateCompany(company.id, { listed: next }));
          if (!saved) return;
          toast(next ? 'Фірма зʼявиться в пошуку' : 'Фірму прибрано з каталогу');
          loadCompanies(host);
        },
      }, company.listed ? 'Прибрати з каталогу' : 'Показувати в каталозі')));
  }

  const teamHost = el('div');
  block.append(teamHost);
  loadTeam(teamHost, company, host);

  return block;
}

async function loadTeam(host, company, rootHost) {
  host.replaceChildren(sectionTitle('Команда'), spinner());

  const [team, requests, invites] = await Promise.all([
    run(() => teamOf(company.id)),
    canManage(company.role) ? run(() => pendingRequests(company.id)) : Promise.resolve([]),
    canManage(company.role) ? run(() => activeInvites(company.id)) : Promise.resolve([]),
  ]);

  if (team === null) {
    host.replaceChildren(sectionTitle('Команда'), el('p.settings-note', 'Не вдалося завантажити.'));
    return;
  }

  const parts = [sectionTitle('Команда', el('span.section-hint', String(team.length)))];

  parts.push(el('div.list', team.map((member) => el(
    'article.row',
    {
      onclick: company.role === 'owner' && !member.isMe
        ? () => memberSheet(member, company, host, rootHost)
        : null,
    },
    el('span.row-mark', member.isMe ? '🙋' : '👤'),
    el('div.row-body',
      el('p.row-title', member.name || member.title || 'Без імені'),
      el('div.row-meta',
        chip(roleLabel(member.role), member.role === 'owner' ? 'money' : ''),
        member.isMe ? chip('це ти') : null,
        member.phone ? chip(`📞 ${member.phone}`) : null)),
  ))));

  // Заявки на приєднання — те, що потребує твого рішення, має бути помітним.
  if (requests?.length) {
    parts.push(sectionTitle('Заявки', el('span.section-hint', String(requests.length))));
    parts.push(el('div.list', requests.map((request) => el(
      'article.row',
      el('span.row-mark', '✋'),
      el('div.row-body',
        el('p.row-title', request.name),
        request.message && el('p.row-note', request.message),
        el('div.row-meta',
          el('button.link', {
            type: 'button',
            onclick: async () => {
              await run(() => approveRequest(request.id, 'member'));
              toast(`${request.name} у команді`);
              loadTeam(host, company, rootHost);
            },
          }, 'Прийняти'),
          el('button.link', {
            type: 'button',
            onclick: async () => {
              await run(() => declineRequest(request.id));
              toast('Заявку відхилено');
              loadTeam(host, company, rootHost);
            },
          }, 'Відхилити'))),
    ))));
  }

  if (canManage(company.role)) {
    parts.push(sectionTitle('Запрошення'));

    if (invites?.length) {
      parts.push(el('div.list', invites.map((invite) => el(
        'article.row',
        el('div.row-body',
          el('p.row-title.invite-code', invite.code),
          el('p.row-note', `${roleLabel(invite.role)} · діє до ${new Date(invite.expires_at).toLocaleDateString('uk-UA')}`)),
        el('button.link', {
          type: 'button',
          onclick: async (event) => {
            event.stopPropagation();
            await run(() => revokeInvite(invite.id));
            toast('Код скасовано');
            loadTeam(host, company, rootHost);
          },
        }, 'Скасувати'),
      ))));
    }

    parts.push(el('div.form',
      el('button.btn.btn--ghost.btn--wide', {
        type: 'button',
        onclick: async () => {
          const invite = await run(() => createInvite(company.id, 'member'));
          if (!invite) return;
          loadTeam(host, company, rootHost);
          try {
            await navigator.clipboard.writeText(invite.code);
            toast(`Код ${invite.code} скопійовано`);
          } catch {
            toast(`Код: ${invite.code}`);
          }
        },
      }, '+ Створити код запрошення'),
      el('p.settings-note',
        'Передай код людині — вона вводить його при вході й одразу опиняється в команді. ' +
        'Код діє два тижні й спрацьовує один раз.')));
  }

  host.replaceChildren(...parts);
}

function memberSheet(member, company, teamHost, rootHost) {
  let role = member.role;

  openSheet({
    title: member.name || 'Учасник',
    body: formBody(
      field('Роль', selectInput(
        ROLES.map((item) => ({ value: item.id, label: `${item.label} — ${item.hint}` })),
        { value: role, onchange: (event) => { role = event.target.value; } },
      )),
    ),
    actions: [
      el('button.btn.btn--danger', {
        type: 'button',
        onclick: () => confirmSheet({
          title: 'Прибрати з команди?',
          message: `${member.name || 'Ця людина'} втратить доступ до проєктів фірми.`,
          onConfirm: async () => {
            await run(() => removeMember(member.id));
            toast('Прибрано з команди');
            loadTeam(teamHost, company, rootHost);
          },
        }),
      }, 'Прибрати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: async () => {
          if (role !== member.role) {
            await run(() => changeRole(member.id, role));
            toast(`Роль змінено: ${roleLabel(role)}`);
          }
          closeSheet();
          loadTeam(teamHost, company, rootHost);
        },
      }, 'Зберегти'),
    ],
  });
}

function createCompanySheet(host) {
  const draft = { name: '', slug: '', city: '', about: '', listed: true };
  const error = el('p.settings-note');

  const slugInput = textInput({
    placeholder: 'dreamcut',
    autocapitalize: 'none',
    oninput: (event) => { draft.slug = event.target.value.toLowerCase(); },
  });

  openSheet({
    title: 'Нова фірма',
    body: formBody(
      field('Назва', textInput({
        placeholder: 'DreamCut Film',
        oninput: (event) => {
          draft.name = event.target.value;
          // Коротке імʼя підставляється саме, доки його не правили руками.
          if (!slugInput.dataset.touched) {
            draft.slug = makeSlug(draft.name);
            slugInput.value = draft.slug;
          }
        },
      })),
      field('Коротке імʼя', slugInput,
        'Латиницею, для посилань і пошуку. Його доведеться диктувати вголос — хай буде простим.'),
      field('Місто', textInput({
        placeholder: 'Львів',
        oninput: (event) => { draft.city = event.target.value; },
      })),
      field('Про фірму', textArea({
        placeholder: 'Що знімаєте, чим вирізняєтесь',
        oninput: (event) => { draft.about = event.target.value; },
      })),
      field('У каталозі', segmented(
        [{ value: 'yes', label: 'Показувати' }, { value: 'no', label: 'Приховати' }],
        'yes',
        (value) => { draft.listed = value === 'yes'; },
      ), 'Показану фірму знаходять у пошуку й надсилають заявки. Прихована ' +
         'працює так само, але тільки за кодом запрошення.'),
      error,
    ),
    actions: [
      el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: async (event) => {
          if (!draft.name.trim()) { error.textContent = 'Впиши назву'; return; }
          if (!isValidSlug(draft.slug)) {
            error.textContent = 'Коротке імʼя: латиниця, цифри й дефіс, від 2 символів';
            return;
          }
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = 'Створюю…';

          const created = await run(() => createCompany(draft), {
            onError: (message) => { error.textContent = message; },
          });

          button.disabled = false;
          button.textContent = 'Створити';
          if (!created) return;

          closeSheet();
          toast(`Фірму «${draft.name}» створено`);
          loadCompanies(host);
        },
      }, 'Створити'),
    ],
  });
}

function findCompanySheet(host) {
  const results = el('div.list');
  let query = '';

  const search = async () => {
    if (query.trim().length < 2) {
      results.replaceChildren(el('p.settings-note', 'Впиши хоча б дві літери назви.'));
      return;
    }
    results.replaceChildren(spinner('Шукаю…'));

    const found = await run(() => searchCompanies(query));
    if (!found) return;

    if (!found.length) {
      results.replaceChildren(el('p.settings-note', 'Такої фірми не знайшлось. Перевір назву або створи свою.'));
      return;
    }

    results.replaceChildren(...found.map((company) => el(
      'article.row',
      {
        onclick: async () => {
          const sent = await run(() => requestJoin(company.id));
          if (!sent) return;
          closeSheet();
          toast('Заявку надіслано — чекай на схвалення');
          loadCompanies(host);
        },
      },
      el('div.row-body',
        el('p.row-title', company.name),
        el('p.row-note', [company.city, `@${company.slug}`].filter(Boolean).join(' · '))),
      el('span.card-chevron', '›'),
    )));
  };

  openSheet({
    title: 'Знайти фірму',
    body: el('div.form',
      el('div.search-bar', el('input.input.input--search', {
        type: 'search',
        placeholder: 'Назва фірми',
        oninput: (event) => { query = event.target.value; search(); },
      })),
      el('p.settings-note', 'Тап по фірмі надішле заявку на приєднання. Керівник її побачить і прийме.'),
      results,
    ),
    actions: [el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Закрити')],
  });
}

function inviteCodeSheet(host) {
  let code = '';
  const error = el('p.settings-note');

  openSheet({
    title: 'Код запрошення',
    body: formBody(
      field('Код', textInput({
        placeholder: 'ABCD-1234',
        autocapitalize: 'characters',
        oninput: (event) => { code = event.target.value; },
      }), 'Код дає керівник фірми. Він діє два тижні.'),
      error,
    ),
    actions: [
      el('button.btn.btn--ghost', { type: 'button', onclick: () => closeSheet() }, 'Скасувати'),
      el('button.btn.btn--primary', {
        type: 'button',
        onclick: async () => {
          if (!code.trim()) { error.textContent = 'Впиши код'; return; }
          const company = await run(() => redeemInvite(code), {
            onError: (message) => { error.textContent = message; },
          });
          if (!company) return;
          closeSheet();
          toast(`Ти в команді «${company.name}»`);
          loadCompanies(host);
        },
      }, 'Приєднатися'),
    ],
  });
}
