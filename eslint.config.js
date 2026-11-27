import js from '@eslint/js';
import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', '**/*.ts', '**/*.tsx'],
  },
  js.configs.recommended,
  firebaseRulesPlugin.configs['flat/recommended'],
];
