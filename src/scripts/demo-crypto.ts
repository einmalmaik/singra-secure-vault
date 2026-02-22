import { generateHybridKeyPair, hybridEncrypt, hybridDecrypt } from '../services/pqCryptoService';

async function runDemo() {
    console.log('\n======================================================');
    console.log(' SINGRA VAULT - POST-QUANTUM HYBRID ENCRYPTION DEMO');
    console.log('======================================================\n');

    console.log('--- 1. SCHLÜSSELGENERIERUNG ---');
    console.log('Generiere hybrides Schlüsselpaar (Post-Quantum ML-KEM-768 + klassisch RSA-4096-OAEP) ...');

    // Timer start
    const startGen = performance.now();
    const keys = await generateHybridKeyPair();
    const endGen = performance.now();

    console.log(`\n✅ Schlüssel in ${(endGen - startGen).toFixed(1)}ms erfolgreich generiert:`);
    console.log(`🔑 PQ Public Key (ML-KEM):  ${keys.pqPublicKey.length} Zeichen (entspricht 1184 Bytes)`);
    console.log(`🔑 PQ Secret Key (ML-KEM):  ${keys.pqSecretKey.length} Zeichen (entspricht 2400 Bytes)`);
    console.log(`🔑 RSA Public Key (JWK):    ${keys.rsaPublicKey.substring(0, 45)}...`);

    console.log('\n\n--- 2. VERSCHLÜSSELUNG (HYBRID ENCRYPT) ---');
    const geheimnis = 'Das ist ein streng geheimes Master-Passwort oder ein AES-Collection-Key: 🔐';
    console.log(`Klartext zu verschlüsseln:\n> "${geheimnis}"`);

    console.log('\nVerschlüssele jetzt mit ML-KEM-768 & RSA-4096 ...');

    const startEnc = performance.now();
    const ciphertextBase64 = await hybridEncrypt(geheimnis, keys.pqPublicKey, keys.rsaPublicKey);
    const endEnc = performance.now();

    console.log(`\n✅ Erfolgreich in ${(endEnc - startEnc).toFixed(1)}ms verschlüsselt!`);
    console.log('\nDer finale Ciphertext (Base64) sieht so aus:');
    console.log('--------------------------------------------------');
    console.log(`${ciphertextBase64.substring(0, 150)}... `);
    console.log(`[Gesamtlänge: ${ciphertextBase64.length} Zeichen]`);
    console.log('--------------------------------------------------');

    console.log('\n👀 Was steckt in diesem Ciphertext?');
    const bytes = atob(ciphertextBase64);
    console.log('1. Version Byte:       0x0' + bytes.charCodeAt(0) + ' (Standard v1 = Hybrid)');
    console.log('2. ML-KEM-768 Kapsel:  1088 Bytes (Schützt den temporären AES-Key "Post-Quantum")');
    console.log('3. RSA-4096 Kapsel:    512 Bytes  (Schützt den temporären AES-Key "Klassisch")');
    console.log('4. AES-256-GCM IV:     12 Bytes');
    console.log('5. AES-256 Ciphertext: Restliche Bytes (Die eigentlichen hochverschlüsselten Daten + Auth Tag)');

    console.log('\n\n--- 3. ENTSCHLÜSSELUNG (HYBRID DECRYPT) ---');
    console.log('Entschlüssele Daten mit PQ Secret Key und RSA Private Key ...');

    const startDec = performance.now();
    const decrypted = await hybridDecrypt(ciphertextBase64, keys.pqSecretKey, keys.rsaPrivateKey);
    const endDec = performance.now();

    console.log(`\n✅ Erfolgreich in ${(endDec - startDec).toFixed(1)}ms entschlüsselt!`);
    console.log(`Wiederhergestellter Klartext:\n> "${decrypted}"`);

    if (decrypted === geheimnis) {
        console.log('\n🎉 BEWEIS ERFOLGREICH: Original und entschlüsselter Text stimmen zu 100% überein!');
    }
}

runDemo().catch(console.error);
