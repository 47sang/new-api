/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, it } from 'vitest'

import { MULTI_LINE_KEY_ERROR, validateKeyLineBreaks } from '../channel-form'

describe('validateKeyLineBreaks', () => {
  it('rejects a multi-line key when creating a channel with the single add mode', () => {
    const result = validateKeyLineBreaks('ark-aaa\nark-bbb', {
      isEditing: false,
      isMultiKeyChannel: false,
      addMode: 'single',
    })
    expect(result).toBe(MULTI_LINE_KEY_ERROR)
  })

  it('rejects a multi-line key when editing a single-key channel', () => {
    const result = validateKeyLineBreaks('ark-aaa\nark-bbb', {
      isEditing: true,
      isMultiKeyChannel: false,
    })
    expect(result).toBe(MULTI_LINE_KEY_ERROR)
  })

  it('accepts a plain single-line key without any special context', () => {
    const result = validateKeyLineBreaks('ark-aaa', {
      isEditing: true,
      isMultiKeyChannel: false,
    })
    expect(result).toBeNull()
  })

  it('rejects a multi-line key with CRLF line endings when editing a single-key channel', () => {
    const result = validateKeyLineBreaks('ark-aaa\r\nark-bbb', {
      isEditing: true,
      isMultiKeyChannel: false,
    })
    expect(result).toBe(MULTI_LINE_KEY_ERROR)
  })

  it('defaults the create add mode to single when it is omitted', () => {
    const result = validateKeyLineBreaks('ark-aaa\nark-bbb', {
      isEditing: false,
      isMultiKeyChannel: false,
    })
    expect(result).toBe(MULTI_LINE_KEY_ERROR)
  })

  it('accepts a multi-line key when creating with the multi_to_single add mode', () => {
    const result = validateKeyLineBreaks('ark-aaa\nark-bbb', {
      isEditing: false,
      isMultiKeyChannel: false,
      addMode: 'multi_to_single',
    })
    expect(result).toBeNull()
  })

  it('accepts a multi-line key when creating with the batch add mode', () => {
    const result = validateKeyLineBreaks('ark-aaa\nark-bbb', {
      isEditing: false,
      isMultiKeyChannel: false,
      addMode: 'batch',
    })
    expect(result).toBeNull()
  })

  it('accepts a multi-line key when editing a multi-key channel', () => {
    const result = validateKeyLineBreaks('ark-aaa\nark-bbb', {
      isEditing: true,
      isMultiKeyChannel: true,
    })
    expect(result).toBeNull()
  })

  it('accepts a multi-line JSON object credential on a single-key channel', () => {
    const serviceAccount = '{\n  "client_email": "sa@project.iam"\n}'
    const result = validateKeyLineBreaks(serviceAccount, {
      isEditing: true,
      isMultiKeyChannel: false,
    })
    expect(result).toBeNull()
  })

  it('rejects a multi-line JSON array credential when creating with the single add mode', () => {
    const result = validateKeyLineBreaks('[{\n  "a": 1\n}]', {
      isEditing: false,
      isMultiKeyChannel: false,
      addMode: 'single',
    })
    expect(result).toBe(MULTI_LINE_KEY_ERROR)
  })

  it('accepts a multi-line JSON array credential when creating with the batch add mode', () => {
    const result = validateKeyLineBreaks('[{\n  "a": 1\n}]', {
      isEditing: false,
      isMultiKeyChannel: false,
      addMode: 'batch',
    })
    expect(result).toBeNull()
  })

  it('accepts an empty key', () => {
    const result = validateKeyLineBreaks('', {
      isEditing: true,
      isMultiKeyChannel: false,
    })
    expect(result).toBeNull()
  })

  it('accepts an undefined key', () => {
    const result = validateKeyLineBreaks(undefined, {
      isEditing: true,
      isMultiKeyChannel: false,
    })
    expect(result).toBeNull()
  })

  it('accepts a single key with a trailing newline', () => {
    const result = validateKeyLineBreaks('ark-aaa\n', {
      isEditing: true,
      isMultiKeyChannel: false,
    })
    expect(result).toBeNull()
  })
})
