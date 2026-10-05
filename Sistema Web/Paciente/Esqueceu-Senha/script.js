const form = document.getElementById('form-recuperacao');

form.addEventListener('submit', (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const dadosRecuperacao = { email: email };

        const API_URL = '/api/paciente/auth/recuperar-senha';

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
            alert('Se o e-mail estiver cadastrado, você vai receber um link para redefinir a senha. Verifique também a caixa de spam.');
            window.location.href = '../login/index.html';
        } else {
            response.json().then((d) => alert(d.message || 'Não foi possível enviar o link. Tente novamente.')).catch(() => alert('Não foi possível enviar o link. Tente novamente.'));
        }
    })
    .catch(() => {
        alert('Não foi possível conectar ao servidor. Tente novamente em instantes.');
    });
});