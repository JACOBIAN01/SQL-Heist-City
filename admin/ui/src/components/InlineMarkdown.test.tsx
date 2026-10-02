import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { InlineMarkdown } from './InlineMarkdown';

afterEach(cleanup);

describe('InlineMarkdown', () => {
  it('renders bold, code and line breaks', () => {
    const { container } = render(<InlineMarkdown text={'Find **IT** staff\nuse `WHERE`'} />);
    expect(container.querySelector('strong')?.textContent).toBe('IT');
    expect(container.querySelector('code')?.textContent).toBe('WHERE');
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });

  it('never interprets HTML', () => {
    const { container } = render(<InlineMarkdown text={'<img src=x onerror=alert(1)> **ok**'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
