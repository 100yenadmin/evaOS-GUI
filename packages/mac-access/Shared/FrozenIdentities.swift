import Foundation

public enum MacAccessIdentity {
    public static let teamID = "TC6MS3T6NN"
    public static let appBundleID = "com.evaos.mac-access"
    public static let helperServiceID = "com.evaos.mac-access.helper"
    public static let connectorServiceID = "com.evaos.mac-access.connector"

    public static let appDesignatedRequirement =
        "anchor apple generic and certificate leaf[subject.OU] = \"TC6MS3T6NN\" and identifier \"com.evaos.mac-access\""
    public static let helperDesignatedRequirement =
        "anchor apple generic and certificate leaf[subject.OU] = \"TC6MS3T6NN\" and identifier \"com.evaos.mac-access.helper\""
    public static let connectorDesignatedRequirement =
        "anchor apple generic and certificate leaf[subject.OU] = \"TC6MS3T6NN\" and identifier \"com.evaos.mac-access.connector\""
    public static let workbenchDesignatedRequirement =
        "anchor apple generic and certificate leaf[subject.OU] = \"TC6MS3T6NN\" and identifier \"com.evaos.workbench\""
    public static let legacyWorkbenchDesignatedRequirement =
        "anchor apple generic and certificate leaf[subject.OU] = \"TC6MS3T6NN\" and identifier \"com.electricsheephq.EvaDesktop\""

    public static let appDesignatedRequirementSHA256 =
        "da635352f249b4213aa1a96c41d7979d8b25d86b056b9f0929c1b414e35896fb"
    public static let helperDesignatedRequirementSHA256 =
        "222107bb855cfc463805777c76ca8cfdac0d1145957c5f190c234e52bfd277aa"
    public static let connectorDesignatedRequirementSHA256 =
        "0c3de778270de5b4a1992d0e13d4f27e41929c7ace94ae143bcba92a555be422"
    public static let workbenchDesignatedRequirementSHA256 =
        "ff4fc126bb70bbf7fcc3cc0957377d67185124b5e31b19760357333a8a0ae329"
    public static let legacyWorkbenchDesignatedRequirementSHA256 =
        "c6038eaf8a20c83a1aabfd1bf8eb4053877b7af5627e570eb1de37721e76b776"

    public static let productionKeychainAccessGroupSuffix = "com.evaos.mac-access.credentials"
    public static let developmentKeychainAccessGroupSuffix = "com.evaos.mac-access.development.credentials"
    public static let connectorCredentialService = "com.evaos.mac-access.connector-credential"
    public static let auditAnchorAccessGroupSuffix = "com.evaos.mac-access.audit-anchor"
    public static let auditAnchorService = "com.evaos.mac-access.audit-anchor"
}
