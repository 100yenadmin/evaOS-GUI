/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input, type InputProps } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { Search } from '@icon-park/react';
import classNames from 'classnames';
import type { CSSProperties } from 'react';
import React, { forwardRef } from 'react';
import styles from './AionInlineSearchInput.module.css';

/**
 * Props for the controlled inline search field used by runtime selector menus.
 * `wrapTestId` labels the layout wrapper, while `data-testid` labels Arco's
 * underlying input element.
 */
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
    InputProps,
    'value' | 'onChange' | 'placeholder' | 'disabled' | 'autoFocus' | 'className' | 'style' | 'prefix'
  >;
};

/**
 * Compact Arco-backed search input for selector popups. The forwarded ref uses
 * Arco's `RefInputType`, exposing `focus`, `blur`, and the native input as `dom`.
 */
const AionInlineSearchInput = forwardRef<RefInputType, AionInlineSearchInputProps>((props, ref) => {
  const { value, onChange, placeholder, className, style, autoFocus, disabled, wrapTestId, inputProps } = props;

  return (
    <div className={styles.searchContainer} data-testid={wrapTestId}>
      <Input
        {...inputProps}
        ref={ref}
        className={classNames(styles.searchInput, className)}
        style={style}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        data-testid={props['data-testid']}
        prefix={<Search theme='outline' size='13' className={styles.icon} fill='currentColor' aria-hidden='true' />}
        onChange={onChange}
      />
    </div>
  );
});

AionInlineSearchInput.displayName = 'AionInlineSearchInput';

export default AionInlineSearchInput;
