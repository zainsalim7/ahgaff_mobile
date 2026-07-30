import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// قالب HTML للويب: يعلن اللغة العربية ويمنع الترجمة التلقائية للمتصفح التي تشوه النصوص
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ar" dir="rtl" translate="no">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta httpEquiv="Content-Language" content="ar" />
        <meta name="google" content="notranslate" />
        <title>نظام جامعة الأحقاف</title>
        <ScrollViewStyleReset />
      </head>
      <body className="notranslate">{children}</body>
    </html>
  );
}
