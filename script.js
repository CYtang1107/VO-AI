function analyseVariation() {

    const quantity =
        Number(document.getElementById("quantity").value);

    const originalRate =
        Number(document.getElementById("originalRate").value);

    const revisedRate =
        Number(document.getElementById("revisedRate").value);


    const originalCost =
        quantity * originalRate;

    const revisedCost =
        quantity * revisedRate;

    const additionalCost =
        revisedCost - originalCost;


    const percentageIncrease =
        ((revisedRate - originalRate) / originalRate) * 100;


    document.getElementById("originalCost").innerText =
        "RM " + originalCost.toLocaleString("en-MY", {
            minimumFractionDigits: 2
        });


    document.getElementById("revisedCost").innerText =
        "RM " + revisedCost.toLocaleString("en-MY", {
            minimumFractionDigits: 2
        });


    document.getElementById("costResult").innerText =
        "RM " + additionalCost.toLocaleString("en-MY", {
            minimumFractionDigits: 2
        });


    document.getElementById("percentageResult").innerText =
        "↑ " + percentageIncrease.toFixed(1) +
        "% compared with original rate";


    alert(
        "VO-AI analysis completed!\n\n" +
        "Potential Variation Detected\n" +
        "Estimated Additional Cost: RM " +
        additionalCost.toLocaleString("en-MY", {
            minimumFractionDigits: 2
        })
    );

}


function generateReport() {

    alert(
        "VO Report Generator\n\n" +
        "Draft VO report is being prepared..."
    );

}