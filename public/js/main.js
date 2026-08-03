async function sendLeadToServer(name, phone, website) {
  const response = await fetch("/api/lead", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, phone, website }),
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Помилка надсилання заявки");
  }

  return result;
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("leadForm");
  const nameInput = document.getElementById("userName");
  const phoneInput = document.getElementById("userPhone");
  const honeypotInput = document.getElementById("website_hp");
  const submitBtn = form.querySelector(".btn-submit");

  const nameError = document.getElementById("nameError");
  const phoneError = document.getElementById("phoneError");

  function validateName() {
    const value = nameInput ? nameInput.value.trim() : "";
    const isValid = /^[a-zA-Zа-яА-ЯіІїЇєЄґҐ'’\s-]+$/.test(value) && value.length >= 2;

    toggleError(nameError, nameInput, isValid);
    return isValid;
  }

  function validatePhone() {
    const rawValue = phoneInput ? phoneInput.value : "";
    const digits = rawValue.replace(/\D/g, "");
    const validCodes = ["39", "50", "63", "66", "67", "68", "73", "77", "91", "92", "93", "94", "95", "96", "97", "98", "99"];

    let isValid = false;

    if (digits.length === 12 && digits.startsWith("380")) {
      const code = digits.substring(3, 5);
      isValid = validCodes.includes(code);
    } else if (digits.length === 10 && digits.startsWith("0")) {
      const code = digits.substring(1, 3);
      isValid = validCodes.includes(code);
    }

    toggleError(phoneError, phoneInput, isValid);
    return isValid;
  }

  function toggleError(errorEl, inputEl, isValid) {
    if (!errorEl || !inputEl) return;
    if (isValid) {
      errorEl.style.display = "none";
      inputEl.classList.remove("is-invalid");
    } else {
      errorEl.style.display = "flex";
      inputEl.classList.add("is-invalid");
    }
  }

  if (nameInput) nameInput.addEventListener("blur", validateName);
  if (phoneInput) phoneInput.addEventListener("blur", validatePhone);

  if (nameInput) {
    nameInput.addEventListener("input", () => {
      if (nameError) nameError.style.display = "none";
      nameInput.classList.remove("is-invalid");
    });
  }

  if (phoneInput) {
    phoneInput.addEventListener("input", () => {
      if (phoneError) phoneError.style.display = "none";
      phoneInput.classList.remove("is-invalid");
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const hpValue = honeypotInput ? honeypotInput.value : "";
      if (hpValue !== "") return;

      const isNameValid = validateName();
      const isPhoneValid = validatePhone();

      if (!isNameValid || !isPhoneValid) return;

      const cleanPhone = phoneInput.value.replace(/\D/g, "");

      try {
        submitBtn.disabled = true;
        submitBtn.innerText = "Надсилання...";

        await sendLeadToServer(nameInput.value.trim(), cleanPhone, hpValue);

        alert("Дякуємо! Вашу заявку успішно прийнято.");
        form.reset();
      } catch (err) {
        alert("Не вдалося надіслати: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "Надіслати заявку";
      }
    });
  }
});