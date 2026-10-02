import type { QuestionTemplateInput } from './template';

/** The sample question from docs/questions.md. Used by tests across workspaces. */
export const sampleQuestion: QuestionTemplateInput = {
  slug: 'emp-high-earners-dept',
  tier: 1,
  topic: ['select', 'where'],
  title: 'Payroll Leak',
  story_md: 'List the names of employees in **{dept}** who earn more than **{min_salary}**.',
  schema_sql:
    'CREATE TABLE employees(id INTEGER PRIMARY KEY, name TEXT, dept TEXT, salary INTEGER);',
  data_gen: {
    employees: {
      rows: [30, 60],
      columns: {
        id: { kind: 'serial' },
        name: { kind: 'pick', from: 'first_names' },
        dept: { kind: 'pick', from: ['Teller', 'Security', 'Audit', 'IT'] },
        salary: { kind: 'int', min: 2000, max: 9000, step: 100 },
      },
    },
  },
  params: {
    dept: { kind: 'pick', from: ['Teller', 'Security', 'Audit', 'IT'] },
    min_salary: { kind: 'int', min: 3000, max: 6000, step: 500 },
  },
  reference_sql: 'SELECT name FROM employees WHERE dept = {dept|sql} AND salary > {min_salary};',
  hints: [{ text: 'Combine two conditions with AND.', cost: 0.05 }],
};
