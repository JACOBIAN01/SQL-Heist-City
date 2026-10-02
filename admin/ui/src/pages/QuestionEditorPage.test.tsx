import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { fakeApi, renderWithProviders, teacher } from '../testing/render';
import { QuestionEditorPage } from './QuestionEditorPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const template = questionTemplateSchema.parse(sampleQuestion);
const detail = (over: object = {}) => ({
  id: 7,
  slug: template.slug,
  title: template.title,
  tier: 1,
  topics: template.topic,
  enabled: true,
  version: 2,
  updatedAt: '',
  template,
  ...over,
});

function renderEditor(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/questions/:id" element={<QuestionEditorPage />} />
    </Routes>,
    path,
  );
}

describe('QuestionEditorPage', () => {
  it('loads a question, edits the title and saves with PUT', async () => {
    const calls = fakeApi({
      'GET /auth/me': () => ({ body: { user: teacher } }),
      'GET /questions/7': () => ({ body: { question: detail() } }),
      'PUT /questions/7': (body) => ({
        body: { question: detail({ title: (body as { title: string }).title, version: 3 }) },
      }),
    });
    renderEditor('/questions/7');
    const title = await screen.findByLabelText('Title');
    const user = userEvent.setup();
    await user.clear(title);
    await user.type(title, 'Renamed heist');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved ✓')).toBeTruthy();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toMatchObject({
      title: 'Renamed heist',
      slug: template.slug,
      data_gen: template.data_gen,
    });
  });

  it('shows server validation errors per seed', async () => {
    fakeApi({
      'GET /auth/me': () => ({ body: { user: teacher } }),
      'GET /questions/7': () => ({ body: { question: detail() } }),
      'PUT /questions/7': () => ({
        status: 422,
        body: {
          error: {
            code: 'question_invalid',
            message: 'The reference query failed on 5 of 5 test seeds',
            details: [{ seed: 'validate-1', issues: ['error'], error: 'no such column: nope' }],
          },
        },
      }),
    });
    renderEditor('/questions/7');
    await screen.findByLabelText('Title');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('failed on 5 of 5');
    expect(alert.textContent).toContain('no such column: nope');
  });

  it('starts new questions from a valid starter and creates with POST', async () => {
    const calls = fakeApi({
      'GET /auth/me': () => ({ body: { user: teacher } }),
      'POST /questions': () => ({ status: 201, body: { question: detail({ id: 9 }) } }),
      'GET /questions/9': () => ({ body: { question: detail({ id: 9 }) } }),
    });
    renderEditor('/questions/new');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save' }));
    await screen.findByText('Saved ✓');
    const post = calls.find((c) => c.method === 'POST');
    expect(questionTemplateSchema.safeParse(post?.body).success).toBe(true);
  });
});
