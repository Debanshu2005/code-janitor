module.exports = {
  env: {
    node: true,
    es2021: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module'
  },
  overrides: [
    {
      files: [
        '**/__tests__/**/*.js',
        '**/*.test.js',
        '**/*.spec.js'
      ],
      env: {
        jest: true
      }
    }
  ],
  rules: {
    'no-unused-vars': 'warn',
    'no-console': 'off',
    'semi': ['error', 'always'],
    'quotes': ['error', 'double']
  }
};
