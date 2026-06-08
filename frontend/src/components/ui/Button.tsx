import { ButtonHTMLAttributes } from 'react';

const variants = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
  secondary: 'border border-slate-700 text-slate-300 hover:bg-slate-800',
  danger: 'bg-red-900/50 text-red-300 border border-red-800 hover:bg-red-900',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
