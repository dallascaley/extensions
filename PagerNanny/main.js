const TargetUser = 'Dallas Caley';
let redirectionSet = false;

// Uncomment this area when you want it to start looping forever
window.setTimeout(function() {
    window.location.reload();
}, 60000);
// end of uncomment area

console.log('Script Started');
let incidentSearch = setInterval(findIncidents, 1000);

function findIncidents() {
    console.log('finding incidents');
    let incidents = document.getElementsByClassName("urgency-row-high");
    if (typeof incidents === 'object' && incidents.length > 0) {
        console.log('incidents list found');
        clearInterval(incidentSearch);
        for (const [key, incident] of Object.entries(incidents)) {
            //Do not remove these console logs...
            console.log("individual incident");
            console.log(incident);
            let resolved_cells = incident.querySelectorAll(".status-cell-resolved");
            //For some reason, it doesn't work without them...
            console.log('resolved cells');
            console.log(resolved_cells);
            console.log('Length of resolved cells: ' + resolved_cells.length);

            if (resolved_cells.length > 0) {
                console.log("Resolved");
            } else {
                console.log("Triggered");
                let linkElement = incident.querySelector('.details-cell .ember-view');
                console.log('click this link');
                console.log(linkElement);
                let emberViewElements = incident.querySelectorAll('.ember-view a.ember-view');

                for (const [key2, emberView] of Object.entries(emberViewElements)) {
                    console.log('ember view element');
                    console.log(emberView);
                    console.log(emberView.getAttribute('href'));
                    let linkUrl = emberView.getAttribute('href');

                    if (linkUrl.includes('users')) {
                        let assignedUser = emberView.innerHTML;
                        console.log('Assigned user is: ' + assignedUser);
                        if (assignedUser === TargetUser && !redirectionSet) {
                            redirectionSet = true;
                            console.log('Click it!');
                            let destination = linkElement.getAttribute('href');
                            console.log('Redirecting to ' + destination + ' in 30 seconds');
                            window.setTimeout(function() {
                                console.log('Redirecting to ' + destination);
                                window.location.href = destination;
                            }, 30000);
                        }
                    }
                }
            }
        }
    } else {
        console.log('Not on incidents page 13');
        var buttonRow = document.getElementById('actionsButtonsRow');
        if (buttonRow !== undefined && buttonRow !== null) {
            console.log('clearing interval');
            console.log('here is button row');
            console.log(buttonRow);
            clearInterval(incidentSearch);
            var childDivs = buttonRow.children;
            for (var i = 0; i < childDivs.length; i++) {
                var childDiv = childDivs[i];
                console.log('child div class:');
                console.log(childDiv.className);
                if (childDiv.className.includes('resolveButtonContainer')) {
                    console.log('this is the button we want...')
                    var childButton = childDiv.firstElementChild;
                    console.log(childButton);
                    console.log('pressing button in 30 seconds');
                    window.setTimeout(function() {
                        console.log('Fuck off!');
                        childButton.click();
                    }, 30000);
                }
            }
        }

        /*
        Final button -> <button type="button" data-testid="resolveConfirmButton" class="IncidentActions_resolveButton__ZsDZh btn btn-secondary btn-sm">Resolve Incident</button>
        if (typeof resolveButton === 'object' && resolveButton !== null && resolveButton.length > 0) {
            console.log('Resolve button located');
            console.log(resolveButton);
        }
        */
    }
}
