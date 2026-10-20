import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.cache/**'] },
  ...tseslint.configs.recommended,
  {
    plugins: {
      project: {
        rules: {
          'no-comments': {
            create(context) {
              return { Program() { for (const comment of context.sourceCode.getAllComments()) if (comment.type !== 'Shebang') context.report({ loc: comment.loc, message: 'Hand-written files must not contain code comments.' }); } };
            }
          }
        }
      }
    },
    rules: {
      'project/no-comments': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-warning-comments': 'error'
    }
  }
);
