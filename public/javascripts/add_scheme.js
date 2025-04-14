document.addEventListener("DOMContentLoaded", function () {
    const form1 = document.getElementById("add-scheme-form1");

    form1.addEventListener("submit", function (event) {
        // Handle "Not Required" checkboxes
        const notRequiredFields = form1.querySelectorAll("input[type='checkbox']");
        notRequiredFields.forEach((checkbox) => {
            if (checkbox.checked) {
                const fieldName = checkbox.name.replace("_not_required", "");
                const field = form1.querySelector(`[name='${fieldName}']`);
                field.value = null; // Set field value to null
            }
        });
    });
});