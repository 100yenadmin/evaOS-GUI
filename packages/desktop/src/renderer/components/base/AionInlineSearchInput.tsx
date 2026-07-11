/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Search } from '@icon-park/react';
import classNames from 'classnames';
import type { CSSProperties, InputHTMLAttributes, Ref } from 'react';
import React, { forwardRef } from 'react';
import styles from './AionInlineSearchInput.module.css';

export type AionInlineSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
  wrapTestId?: string;
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'placeholder' | 'disabled' | 'autoFocus' | 'className'
  >;
};

const AionInlineSearchInput = forwardRef<HTMLInputElement, AionInlineSearchInputProps>((props, ref) => {
  const { value, onChange, placeholder, className, style, autoFocus, disabled, wrapTestId, inputProps } = props;

  return (
    <div className={classNames(styles.searchbar, className)} style={style} data-testid={wrapTestId}>
      <Search theme='outline' size='13' className={styles.icon} fill='currentColor' aria-hidden='true' />
      <input
        {...inputProps}
        ref={ref as Ref<HTMLInputElement>}
        className={styles.input}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        data-testid={props['data-testid']}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
});

AionInlineSearchInput.displayName = 'AionInlineSearchInput';

export default AionInlineSearchInput;
