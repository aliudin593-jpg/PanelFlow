import https from 'https';

https.get('https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=Hello', (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', res.headers);
});
