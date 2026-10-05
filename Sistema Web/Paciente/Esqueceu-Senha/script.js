const form = document.getElementById('form-recuperacao');

form.addEventListener('submit', (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const dadosRecuperacao = { email: email };

    // Rota que seu colega vai criar no Spring Boot (Java)
    const API_URL = '/api/pacientes/recuperar-senha';

    fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify(dadosRecuperacao)
    })
    .then(response => {
        if (response.ok) {
            alert('Link de recuperação enviado com sucesso! Verifique sua caixa de entrada.');
            window.location.href = '../login/index.html';
        } else {
            alert('E-mail não cadastrado no sistema.');
        }
    })
    .catch(() => {
        // Modo simulação caso o Java esteja desligado nos testes locais
        alert('Simulação: Link de recuperação enviado com sucesso para ' + email);
        window.location.href = '../login/index.html';
    });
});