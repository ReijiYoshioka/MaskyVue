// user-api の /regex-patterns 系レスポンスの型定義。
// 参照: FaceMask/user-api/workspace/regex_storage.py, MaskyFlutter/lib/models/regex_pattern.dart

export interface RegexPattern {
  name: string
  value: string
}

export function parseRegexPatternsResponse(value: unknown): RegexPattern[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error('regex patterns response が JSON オブジェクトではありません。')
  }
  const patterns = (value as { regex_patterns?: unknown }).regex_patterns
  if (typeof patterns !== 'object' || patterns === null) {
    throw new Error('regex patterns response に regex_patterns がありません。')
  }
  return Object.entries(patterns as Record<string, unknown>).map(([name, patternValue]) => {
    if (typeof patternValue !== 'string') {
      throw new Error(`regex_patterns["${name}"] が文字列ではありません。`)
    }
    return { name, value: patternValue }
  })
}
