<?php
$conn = mysqli_connect("localhost","root","","dalocalordering");

$name = $_POST['product_name'];
$price = $_POST['price'];
$seller_id = $_SESSION['seller_id'];

$sql = "INSERT INTO products (seller_id, product_name, price)
        VALUES ('$seller_id','$name','$price')";

mysqli_query($conn,$sql);

echo "Product added!";
?>