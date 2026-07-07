import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // 헤지펀드 단말기 톤: 사파이어 블루 단일 강조색 (그라데이션/네온 대체)
        sapphire: {
          DEFAULT: '#0052FF',
          dim: '#0040CC',
        },
      },
      // 금융 단말기 스타일: 카드/버튼/인풋 전부 직각. rounded-lg/md/sm/xl 클래스를
      // 쓰는 기존 코드를 전부 고치지 않아도 앱 전역에서 자동으로 각지게 렌더된다.
      borderRadius: {
        lg: '0px',
        md: '0px',
        sm: '0px',
        xl: '0px',
      },
      boxShadow: {
        soft: 'none',
      },
    },
  },
  plugins: [],
};

export default config;
