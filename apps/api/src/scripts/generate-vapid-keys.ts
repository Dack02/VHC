import webpush from 'web-push'

const vapidKeys = webpush.generateVAPIDKeys()

console.log('VAPID Keys Generated:')
console.log('=====================')
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`)
console.log()
console.log('Add these to your .env file in apps/api/')
console.log('Also add the public key to apps/web/.env:')
console.log(`VITE_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`)
