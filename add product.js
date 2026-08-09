const currentSeller = localStorage.getItem("currentSeller");
document.getElementById("welcome").innerText = "Welcome " + currentSeller;

// ADD PRODUCT
function addProduct() {

    const name = document.getElementById("productName").value;
    const price = document.getElementById("productPrice").value;

    if(name === "" || price === ""){
        alert("Please fill all fields");
        return;
    }

    fetch("add_product.php", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `seller=${currentSeller}&name=${name}&price=${price}`
    })
    .then(res => res.text())
    .then(data => {

        if(data === "success"){
            alert("Product Added!");
            displayProducts();
        } else {
            alert("Error adding product");
        }

        document.getElementById("productName").value = "";
        document.getElementById("productPrice").value = "";
    });
}

// DISPLAY PRODUCTS FROM DATABASE
function displayProducts() {

    fetch(`get_products.php?seller=${currentSeller}`)
    .then(res => res.json())
    .then(products => {

        const list = document.getElementById("productList");
        list.innerHTML = "";

        products.forEach(p => {

            list.innerHTML += `
            <div class="product-card">
                <h4>${p.product_name}</h4>
                <p>₱${p.price}</p>
            </div>
            `;

        });

    });

}

// GO TO SHOP
function goToShop() {
    window.location.href = "shop.html";
}

// LOGOUT / BACK
function goBack() {
    localStorage.removeItem("currentSeller");
    window.location.href = "homeseller.html";
}

// LOAD PRODUCTS WHEN PAGE OPENS
displayProducts();