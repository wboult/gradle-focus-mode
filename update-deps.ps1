# PowerShell script to update project dependencies for nested structure

# Define mapping from old project names to new nested paths
$mapping = @{
    # Core projects (001-010)
    "project-001" = "core:project-001"
    "project-002" = "core:project-002"
    "project-003" = "core:project-003"
    "project-004" = "core:project-004"
    "project-005" = "core:project-005"
    "project-006" = "core:project-006"
    "project-007" = "core:project-007"
    "project-008" = "core:project-008"
    "project-009" = "core:project-009"
    "project-010" = "core:project-010"
    # UI projects (011-020)
    "project-011" = "ui:project-011"
    "project-012" = "ui:project-012"
    "project-013" = "ui:project-013"
    "project-014" = "ui:project-014"
    "project-015" = "ui:project-015"
    "project-016" = "ui:project-016"
    "project-017" = "ui:project-017"
    "project-018" = "ui:project-018"
    "project-019" = "ui:project-019"
    "project-020" = "ui:project-020"
    # Services projects (021-040)
    "project-021" = "services:project-021"
    "project-022" = "services:project-022"
    "project-023" = "services:project-023"
    "project-024" = "services:project-024"
    "project-025" = "services:project-025"
    "project-026" = "services:project-026"
    "project-027" = "services:project-027"
    "project-028" = "services:project-028"
    "project-029" = "services:project-029"
    "project-030" = "services:project-030"
    "project-031" = "services:project-031"
    "project-032" = "services:project-032"
    "project-033" = "services:project-033"
    "project-034" = "services:project-034"
    "project-035" = "services:project-035"
    "project-036" = "services:project-036"
    "project-037" = "services:project-037"
    "project-038" = "services:project-038"
    "project-039" = "services:project-039"
    "project-040" = "services:project-040"
    # Features projects (041-060)
    "project-041" = "features:project-041"
    "project-042" = "features:project-042"
    "project-043" = "features:project-043"
    "project-044" = "features:project-044"
    "project-045" = "features:project-045"
    "project-046" = "features:project-046"
    "project-047" = "features:project-047"
    "project-048" = "features:project-048"
    "project-049" = "features:project-049"
    "project-050" = "features:project-050"
    "project-051" = "features:project-051"
    "project-052" = "features:project-052"
    "project-053" = "features:project-053"
    "project-054" = "features:project-054"
    "project-055" = "features:project-055"
    "project-056" = "features:project-056"
    "project-057" = "features:project-057"
    "project-058" = "features:project-058"
    "project-059" = "features:project-059"
    "project-060" = "features:project-060"
    # Infrastructure projects (061-080)
    "project-061" = "infrastructure:project-061"
    "project-062" = "infrastructure:project-062"
    "project-063" = "infrastructure:project-063"
    "project-064" = "infrastructure:project-064"
    "project-065" = "infrastructure:project-065"
    "project-066" = "infrastructure:project-066"
    "project-067" = "infrastructure:project-067"
    "project-068" = "infrastructure:project-068"
    "project-069" = "infrastructure:project-069"
    "project-070" = "infrastructure:project-070"
    "project-071" = "infrastructure:project-071"
    "project-072" = "infrastructure:project-072"
    "project-073" = "infrastructure:project-073"
    "project-074" = "infrastructure:project-074"
    "project-075" = "infrastructure:project-075"
    "project-076" = "infrastructure:project-076"
    "project-077" = "infrastructure:project-077"
    "project-078" = "infrastructure:project-078"
    "project-079" = "infrastructure:project-079"
    "project-080" = "infrastructure:project-080"
    # Extensions projects (081-100)
    "project-081" = "extensions:project-081"
    "project-082" = "extensions:project-082"
    "project-083" = "extensions:project-083"
    "project-084" = "extensions:project-084"
    "project-085" = "extensions:project-085"
    "project-086" = "extensions:project-086"
    "project-087" = "extensions:project-087"
    "project-088" = "extensions:project-088"
    "project-089" = "extensions:project-089"
    "project-090" = "extensions:project-090"
    "project-091" = "extensions:project-091"
    "project-092" = "extensions:project-092"
    "project-093" = "extensions:project-093"
    "project-094" = "extensions:project-094"
    "project-095" = "extensions:project-095"
    "project-096" = "extensions:project-096"
    "project-097" = "extensions:project-097"
    "project-098" = "extensions:project-098"
    "project-099" = "extensions:project-099"
    "project-100" = "extensions:project-100"
}

# Get all build.gradle files in project directories
$buildFiles = Get-ChildItem -Path "core", "ui", "services", "features", "infrastructure", "extensions" -Recurse -Filter "build.gradle"

foreach ($file in $buildFiles) {
    $content = Get-Content $file.FullName -Raw

    # Replace dependency references
    foreach ($oldName in $mapping.Keys) {
        $newName = $mapping[$oldName]
        # Replace in focusedDep calls: ':project-XXX' -> ':new:path:project-XXX'
        $content = $content -replace ":$oldName", ":$newName"
    }

    # Write back the updated content
    Set-Content $file.FullName $content
    Write-Host "Updated $($file.FullName)"
}

Write-Host "Dependency update complete!"
